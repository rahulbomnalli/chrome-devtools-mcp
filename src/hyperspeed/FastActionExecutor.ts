/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type {ElementHandle} from '../third_party/index.js';
import type {ContextPage} from '../tools/ToolDefinition.js';
import {parseKey} from '../utils/keyboard.js';
import {EventWaiter} from './EventWaiter.js';
import {LatencyTracker} from './LatencyTracker.js';
import {LocatorResolver} from './LocatorResolver.js';
import {RecoveryEngine} from './RecoveryEngine.js';
import {
  type ActionItem,
  type AssertCondition,
  HyperErrorCode,
  type WaitPolicy,
} from './types.js';

function isInputElementHandle(
  h: ElementHandle<Element>,
): h is ElementHandle<HTMLInputElement> {
  return Boolean(h);
}

export interface DomActionSpec {
  id?: string;
  type: string;
  selector?: string;
  css?: string;
  text?: string;
  xpath?: string;
  role?: string;
  name?: string;
  placeholder?: string;
  value?: string;
  attribute?: string;
  scrollDeltaX?: number;
  scrollDeltaY?: number;
  assertionKind?: string;
  assertionExpected?: string;
  delayMs?: number;
}

export interface DomActionResult {
  success: boolean;
  extracted?: unknown;
  error?: string;
}

export interface DomBatchPayload {
  results: DomActionResult[];
  observation?: {
    title: string;
    url: string;
    elements: Array<{
      ref?: string;
      tag?: string;
      role?: string;
      name?: string;
      text?: string;
      value?: string;
      selector?: string;
    }>;
  };
}

function isDomBatchPayload(val: unknown): val is DomBatchPayload {
  return typeof val === 'object' && val !== null && 'results' in val;
}

function isDomAction(action: ActionItem): boolean {
  if (action.synthetic === false) {
    return false;
  }
  if (action.target?.x !== undefined && action.target?.y !== undefined) {
    return false;
  }
  if (action.waitPolicy === 'navigation') {
    return false;
  }
  return (
    action.type === 'click' ||
    action.type === 'dblclick' ||
    action.type === 'fill' ||
    action.type === 'check' ||
    action.type === 'uncheck' ||
    action.type === 'select' ||
    action.type === 'scroll' ||
    action.type === 'extract' ||
    action.type === 'assert' ||
    (action.type === 'wait' && action.delayMs !== undefined)
  );
}

function toDomActionSpec(action: ActionItem): DomActionSpec {
  const target = action.target;
  return {
    id: action.id,
    type: action.type,
    selector: target?.selector ?? target?.css,
    css: target?.css ?? target?.selector,
    text: target?.text ?? target?.label,
    xpath: target?.xpath,
    role: target?.role,
    name: target?.name,
    placeholder: target?.placeholder,
    value: action.value,
    attribute: action.attribute,
    scrollDeltaX: action.scrollDeltaX,
    scrollDeltaY: action.scrollDeltaY,
    assertionKind: action.assertion?.kind,
    assertionExpected: action.assertion?.expected,
    delayMs: action.delayMs,
  };
}

async function runInPageDomBatch(
  specs: DomActionSpec[],
  options?: {observeAfter?: boolean; limit?: number},
): Promise<DomBatchPayload> {
  function findEl(spec: DomActionSpec): Element | null {
    const sel = spec.selector || spec.css;
    if (sel) {
      if (
        sel.startsWith('@') ||
        (/^#\d+$/.test(sel) && !document.querySelector(sel))
      ) {
        const rawIdx = sel.replace(/^[@#]/, '');
        const idx = Number.parseInt(rawIdx, 10);
        if (Number.isInteger(idx)) {
          const stashed = window.hyperspeedElements?.[idx];
          if (stashed && stashed.isConnected) {
            return stashed;
          }
          const isVis = (el: Element): boolean => {
            if (
              'checkVisibility' in el &&
              typeof el.checkVisibility === 'function'
            ) {
              return el.checkVisibility({
                checkOpacity: true,
                checkVisibilityCSS: true,
              });
            }
            const r = el.getBoundingClientRect();
            return (
              r.width > 0 &&
              r.height > 0 &&
              window.getComputedStyle(el).visibility !== 'hidden'
            );
          };
          const query =
            'button, a[href], input, select, textarea, ' +
            '[role="button"], [role="link"], [contenteditable="true"]';
          const allNodes = document.querySelectorAll(query);
          const visibleNodes: Element[] = [];
          for (let k = 0; k < allNodes.length; k++) {
            const el = allNodes[k];
            if (el && isVis(el)) {
              visibleNodes.push(el);
              if (visibleNodes.length > idx) {
                return el;
              }
            }
          }
        }
      }
      if (sel.startsWith('text=')) {
        const targetText = sel.slice(5).replace(/^["']|["']$/g, '');
        const walker = document.createTreeWalker(
          document.body || document.documentElement,
          NodeFilter.SHOW_ELEMENT,
        );
        while (walker.nextNode()) {
          const node = walker.currentNode;
          if (
            node instanceof Element &&
            node.textContent &&
            node.textContent.includes(targetText)
          ) {
            const container = node.closest(
              'button, a[href], input, select, textarea, ' +
                '[role="button"], [role="link"], [contenteditable="true"]',
            );
            if (container) {
              return container;
            }
            if (node.children.length === 0) {
              return node;
            }
          }
        }
      }
      try {
        const found = document.querySelector(sel);
        if (found) {
          return found;
        }
      } catch {
        // Fall through on invalid selector
      }
    }
    if (spec.placeholder) {
      const esc = spec.placeholder.replace(/["\\]/g, '\\$&');
      const found = document.querySelector(`[placeholder="${esc}"]`);
      if (found) {
        return found;
      }
    }
    if (spec.name && spec.role) {
      const escName = spec.name.replace(/["\\]/g, '\\$&');
      const escRole = spec.role.replace(/["\\]/g, '\\$&');
      const found = document.querySelector(
        `[role="${escRole}"][aria-label="${escName}"], ` +
          `[role="${escRole}"][name="${escName}"]`,
      );
      if (found) {
        return found;
      }
    }
    if (spec.text) {
      const walker = document.createTreeWalker(
        document.body || document.documentElement,
        NodeFilter.SHOW_ELEMENT,
      );
      while (walker.nextNode()) {
        const node = walker.currentNode;
        if (
          node instanceof Element &&
          node.textContent &&
          node.textContent.includes(spec.text)
        ) {
          const container = node.closest(
            'button, a[href], input, select, textarea, ' +
              '[role="button"], [role="link"], [contenteditable="true"]',
          );
          if (container) {
            return container;
          }
          if (node.children.length === 0) {
            return node;
          }
        }
      }
    }
    if (spec.xpath) {
      try {
        const res = document.evaluate(
          spec.xpath,
          document,
          null,
          XPathResult.FIRST_ORDERED_NODE_TYPE,
          null,
        );
        if (res.singleNodeValue instanceof Element) {
          return res.singleNodeValue;
        }
      } catch {
        // Fall through on invalid xpath
      }
    }
    return null;
  }

  const results: DomActionResult[] = [];
  for (const spec of specs) {
    switch (spec.type) {
      case 'click':
      case 'dblclick': {
        const el = findEl(spec);
        if (!el) {
          results.push({
            success: false,
            error: `Element not found for ${spec.type}`,
          });
          break;
        }
        el.scrollIntoView({
          block: 'nearest',
          inline: 'nearest',
          behavior: 'instant',
        });
        const count = spec.type === 'dblclick' ? 2 : 1;
        for (let i = 0; i < count; i++) {
          el.dispatchEvent(
            new MouseEvent('pointerdown', {
              bubbles: true,
              cancelable: true,
              view: window,
            }),
          );
          el.dispatchEvent(
            new MouseEvent('mousedown', {
              bubbles: true,
              cancelable: true,
              view: window,
            }),
          );
          el.dispatchEvent(
            new MouseEvent('pointerup', {
              bubbles: true,
              cancelable: true,
              view: window,
            }),
          );
          el.dispatchEvent(
            new MouseEvent('mouseup', {
              bubbles: true,
              cancelable: true,
              view: window,
            }),
          );
          if ('click' in el && typeof el.click === 'function') {
            el.click();
          }
        }
        results.push({success: true});
        break;
      }
      case 'fill': {
        const el = findEl(spec);
        if (!el) {
          results.push({
            success: false,
            error: 'Element not found for fill',
          });
          break;
        }
        el.scrollIntoView({
          block: 'nearest',
          inline: 'nearest',
          behavior: 'instant',
        });
        if ('focus' in el && typeof el.focus === 'function') {
          el.focus();
        }
        const val = spec.value ?? '';
        const isTextArea = el instanceof HTMLTextAreaElement;
        const proto = isTextArea
          ? HTMLTextAreaElement.prototype
          : HTMLInputElement.prototype;
        const desc = Object.getOwnPropertyDescriptor(proto, 'value');
        if (desc && desc.set) {
          desc.set.call(el, val);
        } else if ('value' in el) {
          el.value = val;
        }
        el.dispatchEvent(new Event('input', {bubbles: true, cancelable: true}));
        el.dispatchEvent(
          new Event('change', {bubbles: true, cancelable: true}),
        );
        results.push({success: true});
        break;
      }
      case 'check':
      case 'uncheck': {
        const el = findEl(spec);
        if (!el) {
          results.push({
            success: false,
            error: `Element not found for ${spec.type}`,
          });
          break;
        }
        const shouldCheck = spec.type === 'check';
        if (el instanceof HTMLInputElement) {
          if (el.checked !== shouldCheck) {
            el.click();
          }
        }
        results.push({success: true});
        break;
      }
      case 'select': {
        const el = findEl(spec);
        if (!el) {
          results.push({
            success: false,
            error: 'Element not found for select',
          });
          break;
        }
        if (el instanceof HTMLSelectElement) {
          el.value = spec.value ?? '';
          el.dispatchEvent(new Event('change', {bubbles: true}));
        }
        results.push({success: true});
        break;
      }
      case 'scroll': {
        window.scrollBy({
          left: spec.scrollDeltaX ?? 0,
          top: spec.scrollDeltaY ?? 100,
          behavior: 'instant',
        });
        results.push({success: true});
        break;
      }
      case 'extract': {
        const el = findEl(spec);
        if (!el) {
          if (!spec.selector && !spec.text) {
            results.push({success: true, extracted: document.title});
          } else {
            results.push({
              success: false,
              error: 'Element not found for extract',
            });
          }
          break;
        }
        let extracted: unknown = undefined;
        if (spec.attribute) {
          extracted = el.getAttribute(spec.attribute);
        } else if (
          el instanceof HTMLInputElement ||
          el instanceof HTMLTextAreaElement ||
          el instanceof HTMLSelectElement
        ) {
          extracted = el.value;
        } else {
          extracted = el.textContent?.trim() ?? '';
        }
        results.push({success: true, extracted});
        break;
      }
      case 'assert': {
        const el = findEl(spec);
        const exists = el !== null;
        if (spec.assertionKind === 'exists' && !exists) {
          results.push({
            success: false,
            error: 'Assertion failed: element does not exist',
          });
          break;
        }
        if (spec.assertionKind === 'notExists' && exists) {
          results.push({
            success: false,
            error: 'Assertion failed: element unexpectedly exists',
          });
          break;
        }
        if (el && spec.assertionExpected !== undefined) {
          const text = el.textContent ?? '';
          if (!text.includes(spec.assertionExpected)) {
            results.push({
              success: false,
              error:
                'Assertion failed: text does not include ' +
                `"${spec.assertionExpected}"`,
            });
            break;
          }
        }
        results.push({success: true});
        break;
      }
      case 'wait': {
        if (spec.delayMs && spec.delayMs > 0) {
          await new Promise(r => setTimeout(r, spec.delayMs));
        }
        results.push({success: true});
        break;
      }
      default:
        results.push({
          success: false,
          error: `Unsupported DOM action: ${spec.type}`,
        });
    }
  }

  let observation: DomBatchPayload['observation'] = undefined;
  if (options?.observeAfter) {
    const limit = options.limit ?? 25;
    const isVisible = (el: Element): boolean => {
      if ('checkVisibility' in el && typeof el.checkVisibility === 'function') {
        return el.checkVisibility({
          checkOpacity: true,
          checkVisibilityCSS: true,
        });
      }
      const rect = el.getBoundingClientRect();
      return (
        rect.width > 0 &&
        rect.height > 0 &&
        window.getComputedStyle(el).visibility !== 'hidden'
      );
    };

    // Micro-settle barrier for React 18 / Vue concurrent transitions
    await new Promise(resolve => {
      requestAnimationFrame(() => {
        setTimeout(resolve, 4);
      });
    });

    const query =
      'button, a[href], input, select, textarea, ' +
      '[role="button"], [role="link"], [contenteditable="true"]';
    const candidates: Element[] = [];
    const collectFromRoot = (root: Document | ShadowRoot): void => {
      const matches = root.querySelectorAll(query);
      for (let i = 0; i < matches.length; i++) {
        const el = matches[i];
        if (el && isVisible(el)) {
          candidates.push(el);
        }
      }
      const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT);
      while (walker.nextNode()) {
        const node = walker.currentNode;
        if (node instanceof Element && node.shadowRoot) {
          collectFromRoot(node.shadowRoot);
        }
      }
    };

    collectFromRoot(document);

    const inViewport: Element[] = [];
    const outViewport: Element[] = [];
    for (let i = 0; i < candidates.length; i++) {
      const el = candidates[i];
      if (!el) {
        continue;
      }
      const r = el.getBoundingClientRect();
      const onScreen =
        r.top < window.innerHeight &&
        r.bottom > 0 &&
        r.left < window.innerWidth &&
        r.right > 0;
      if (onScreen) {
        inViewport.push(el);
      } else {
        outViewport.push(el);
      }
    }

    const visibleNodes = inViewport.concat(outViewport).slice(0, limit);
    window.hyperspeedElements = visibleNodes;

    const elements = visibleNodes.map((el, idx) => {
      let sel = '';
      const id = el.id;
      if (id) {
        sel = '#' + CSS.escape(id);
      } else {
        const name = el.getAttribute('name');
        const placeholder = el.getAttribute('placeholder');
        const ariaLabel = el.getAttribute('aria-label');
        const tag = el.tagName.toLowerCase();
        if (name) {
          sel = `${tag}[name="${CSS.escape(name)}"]`;
        } else if (placeholder) {
          sel = `${tag}[placeholder="${CSS.escape(placeholder)}"]`;
        } else if (ariaLabel) {
          sel = `${tag}[aria-label="${CSS.escape(ariaLabel)}"]`;
        } else if (
          typeof el.className === 'string' &&
          el.className.length > 0
        ) {
          const cls = el.className
            .split(/\s+/)
            .filter(
              c =>
                c.length > 0 &&
                !c.includes(':') &&
                !c.includes('/') &&
                !c.includes('('),
            )
            .slice(0, 2)
            .join('.');
          if (cls.length > 0) {
            sel = `${tag}.${cls}`;
          }
        }
        if (sel.length === 0) {
          sel = tag;
        }
      }
      const role = el.getAttribute('role') || undefined;
      const ariaLabel = el.getAttribute('aria-label');
      const placeholder = el.getAttribute('placeholder');
      const name =
        ariaLabel || placeholder || el.getAttribute('name') || undefined;
      const rawText = el.textContent || ariaLabel || placeholder || '';
      const text = rawText.trim().replace(/\s+/g, ' ').slice(0, 40);
      const val =
        'value' in el && typeof el.value === 'string'
          ? el.value.slice(0, 30)
          : undefined;
      const tag = el.tagName.toLowerCase();
      return {
        ref: `@${idx}`,
        tag,
        role: role !== tag ? role : undefined,
        name: name !== text ? name : undefined,
        text: text.length > 0 ? text : undefined,
        value: val && val.length > 0 ? val : undefined,
        selector: sel,
      };
    });

    observation = {
      title: document.title,
      url: window.location.href,
      elements,
    };
  }

  return {results, observation};
}

export interface ExecutionContext {
  page: ContextPage;
  variables: Record<string, unknown>;
  signal?: AbortSignal;
  planId?: string;
}

export interface ActionResult {
  id?: string;
  type: string;
  success: boolean;
  durationMs: number;
  extracted?: unknown;
  error?: string;
  errorCode?: HyperErrorCode;
  perfLog?: string;
}

export class FastActionExecutor {
  /**
   * Fast-path executor for a single browser action with action-specific
   * readiness handling and zero unnecessary post-action delays.
   */
  static async executeAction(
    ctx: ExecutionContext,
    action: ActionItem,
  ): Promise<ActionResult> {
    const page = ctx.page;
    const pptr = page.pptrPage;
    const variables = ctx.variables;
    const tracker = new LatencyTracker(ctx.planId, action.id, action.type);
    const startMs = Date.now();

    if (ctx.signal?.aborted) {
      return {
        id: action.id,
        type: action.type,
        success: false,
        durationMs: 0,
        error: 'Execution cancelled by abort signal',
        errorCode: HyperErrorCode.CANCELLED,
      };
    }

    if (isDomAction(action)) {
      const tDomStart = performance.now();
      try {
        const spec = toDomActionSpec(action);
        const evalRaw = await pptr.evaluate(runInPageDomBatch, [spec]);
        const domRes = Array.isArray(evalRaw)
          ? evalRaw[0]
          : isDomBatchPayload(evalRaw)
            ? evalRaw.results[0]
            : undefined;
        if (domRes?.success) {
          tracker.markAction(tDomStart, performance.now());
          await this.applyWaitPolicy(
            page,
            action.waitPolicy ?? this.getDefaultWaitPolicy(action.type),
            action,
            tracker,
          );
          return {
            id: action.id,
            type: action.type,
            success: true,
            durationMs: Date.now() - startMs,
            extracted: domRes.extracted,
            perfLog: tracker.format(),
          };
        }
      } catch {
        // Fall back to RecoveryEngine / Puppeteer locator
      }
    }

    const recoveryResult = await RecoveryEngine.executeWithRecovery(
      page,
      action,
      async () => {
        let extractedValue: unknown = undefined;
        const effectiveWaitPolicy: WaitPolicy =
          action.waitPolicy ?? this.getDefaultWaitPolicy(action.type);

        switch (action.type) {
          case 'navigate': {
            if (!action.url) {
              throw new Error('navigate action requires url');
            }
            const timeout = action.timeoutMs ?? 15000;
            const tNavStart = performance.now();
            await pptr.goto(action.url, {
              waitUntil: 'domcontentloaded',
              timeout,
            });
            tracker.markNavProbe(tNavStart, performance.now());
            break;
          }

          case 'click':
          case 'dblclick': {
            const isDbl = action.type === 'dblclick';
            const tActionStart = performance.now();

            if (
              action.target?.x !== undefined &&
              action.target?.y !== undefined
            ) {
              await pptr.mouse.click(action.target.x, action.target.y, {
                count: isDbl ? 2 : 1,
              });
              tracker.markAction(tActionStart, performance.now());
            } else if (action.target) {
              const tResolveStart = performance.now();
              const locator = LocatorResolver.resolveLocator(
                page,
                action.target,
              );
              tracker.markResolve(tResolveStart, performance.now());

              if (effectiveWaitPolicy === 'navigation') {
                const navStarted = Promise.withResolvers<boolean>();
                const navHandler = (): void => navStarted.resolve(true);
                pptr.once('framenavigated', navHandler);

                if (locator) {
                  await locator.click({count: isDbl ? 2 : 1});
                } else {
                  using handle = await LocatorResolver.resolveHandle(
                    page,
                    action.target,
                  );
                  await handle.asLocator().click({count: isDbl ? 2 : 1});
                }
                tracker.markAction(tActionStart, performance.now());

                const tNavStart = performance.now();
                const timeout = action.timeoutMs ?? 10000;
                await Promise.race([
                  navStarted.promise,
                  new Promise(r => setTimeout(r, 100)),
                ]);
                pptr.off('framenavigated', navHandler);
                await pptr
                  .waitForNavigation({
                    waitUntil: 'domcontentloaded',
                    timeout,
                  })
                  .catch(() => undefined);
                tracker.markNavProbe(tNavStart, performance.now());
              } else {
                // Non-navigation click: execute directly without forced 100ms DOM quietness
                if (locator) {
                  await locator.click({count: isDbl ? 2 : 1});
                } else {
                  using handle = await LocatorResolver.resolveHandle(
                    page,
                    action.target,
                  );
                  await handle.asLocator().click({count: isDbl ? 2 : 1});
                }
                tracker.markAction(tActionStart, performance.now());
              }
            } else {
              throw new Error('click action requires target or coordinates');
            }

            // Post-condition handling
            await this.applyWaitPolicy(
              page,
              effectiveWaitPolicy,
              action,
              tracker,
            );
            break;
          }

          case 'fill': {
            if (!action.target) {
              throw new Error('fill action requires target');
            }
            const value = action.value ?? '';
            const tResolveStart = performance.now();
            const locator = LocatorResolver.resolveLocator(page, action.target);
            tracker.markResolve(tResolveStart, performance.now());

            const tActionStart = performance.now();
            if (locator) {
              await locator.fill(value);
            } else {
              using handle = await LocatorResolver.resolveHandle(
                page,
                action.target,
              );
              await handle.asLocator().fill(value);
            }
            tracker.markAction(tActionStart, performance.now());

            // Fill proceeds immediately on completion (0ms post wait)
            await this.applyWaitPolicy(
              page,
              effectiveWaitPolicy,
              action,
              tracker,
            );
            break;
          }

          case 'type': {
            const value = action.value ?? '';
            const tActionStart = performance.now();
            await pptr.keyboard.type(value);
            tracker.markAction(tActionStart, performance.now());
            break;
          }

          case 'press_key': {
            if (!action.key) {
              throw new Error('press_key action requires key');
            }
            const tActionStart = performance.now();
            const tokens = parseKey(action.key);
            const [key, ...modifiers] = tokens;
            for (const modifier of modifiers) {
              await pptr.keyboard.down(modifier);
            }
            await pptr.keyboard.press(key);
            for (const modifier of modifiers.toReversed()) {
              await pptr.keyboard.up(modifier);
            }
            tracker.markAction(tActionStart, performance.now());
            await this.applyWaitPolicy(
              page,
              effectiveWaitPolicy,
              action,
              tracker,
            );
            break;
          }

          case 'hover': {
            const tActionStart = performance.now();
            if (
              action.target?.x !== undefined &&
              action.target?.y !== undefined
            ) {
              await pptr.mouse.move(action.target.x, action.target.y);
            } else if (action.target) {
              const locator = LocatorResolver.resolveLocator(
                page,
                action.target,
              );
              if (locator) {
                await locator.hover();
              } else {
                using handle = await LocatorResolver.resolveHandle(
                  page,
                  action.target,
                );
                await handle.asLocator().hover();
              }
            }
            tracker.markAction(tActionStart, performance.now());
            break;
          }

          case 'scroll': {
            const deltaX = action.scrollDeltaX ?? 0;
            const deltaY = action.scrollDeltaY ?? 100;
            const tActionStart = performance.now();
            await pptr.mouse.wheel({deltaX, deltaY});
            tracker.markAction(tActionStart, performance.now());
            break;
          }

          case 'select': {
            if (!action.target) {
              throw new Error('select action requires target');
            }
            const tActionStart = performance.now();
            using handle = await LocatorResolver.resolveHandle(
              page,
              action.target,
            );
            const val = action.value ?? '';
            await handle.evaluate((el, optValue) => {
              if (el instanceof HTMLSelectElement) {
                el.value = optValue;
                el.dispatchEvent(new Event('change', {bubbles: true}));
              }
            }, val);
            tracker.markAction(tActionStart, performance.now());
            break;
          }

          case 'check':
          case 'uncheck': {
            if (!action.target) {
              throw new Error(`${action.type} action requires target`);
            }
            const shouldCheck = action.type === 'check';
            const tActionStart = performance.now();
            using handle = await LocatorResolver.resolveHandle(
              page,
              action.target,
            );
            await handle.evaluate((el, checked) => {
              if (el instanceof HTMLInputElement) {
                el.checked = checked;
                el.dispatchEvent(new Event('change', {bubbles: true}));
              }
            }, shouldCheck);
            tracker.markAction(tActionStart, performance.now());
            break;
          }

          case 'upload': {
            if (!action.target || !action.files || action.files.length === 0) {
              throw new Error('upload action requires target and files');
            }
            const tActionStart = performance.now();
            using handle = await LocatorResolver.resolveHandle(
              page,
              action.target,
            );
            if (isInputElementHandle(handle)) {
              await handle.uploadFile(...action.files);
            }
            tracker.markAction(tActionStart, performance.now());
            break;
          }

          case 'drag': {
            if (!action.target || !action.dragTo) {
              throw new Error('drag action requires target and dragTo');
            }
            const tActionStart = performance.now();
            using fromHandle = await LocatorResolver.resolveHandle(
              page,
              action.target,
            );
            using toHandle = await LocatorResolver.resolveHandle(
              page,
              action.dragTo,
            );
            const fromBox = await fromHandle.boundingBox();
            const toBox = await toHandle.boundingBox();
            if (fromBox && toBox) {
              await pptr.mouse.move(
                fromBox.x + fromBox.width / 2,
                fromBox.y + fromBox.height / 2,
              );
              await pptr.mouse.down();
              await pptr.mouse.move(
                toBox.x + toBox.width / 2,
                toBox.y + toBox.height / 2,
              );
              await pptr.mouse.up();
            }
            tracker.markAction(tActionStart, performance.now());
            break;
          }

          case 'wait': {
            if (action.delayMs !== undefined) {
              const tWaitStart = performance.now();
              await new Promise(r => setTimeout(r, action.delayMs));
              tracker.markDomWait(tWaitStart, performance.now());
              break;
            }
            if (!action.condition) {
              throw new Error('wait action requires condition');
            }
            const tWaitStart = performance.now();
            await EventWaiter.waitForCondition(page, action.condition);
            tracker.markDomWait(tWaitStart, performance.now());
            break;
          }

          case 'extract': {
            const tExtractStart = performance.now();
            if (action.target?.css) {
              const selector = action.target.css;
              const attr = action.attribute ?? 'text';
              extractedValue = await pptr.$$eval(
                selector,
                (elements, attribute) => {
                  return elements.map(el => {
                    if (attribute === 'text') {
                      return el.textContent?.trim() ?? '';
                    }
                    if (attribute === 'value' && 'value' in el) {
                      return String(el.value);
                    }
                    return el.getAttribute(attribute) ?? '';
                  });
                },
                attr,
              );
              if (
                Array.isArray(extractedValue) &&
                extractedValue.length === 1
              ) {
                extractedValue = extractedValue[0];
              }
            } else if (action.target) {
              using handle = await LocatorResolver.resolveHandle(
                page,
                action.target,
              );
              extractedValue = await handle.evaluate((el, attr) => {
                if (attr === 'text') {
                  return el.textContent?.trim() ?? '';
                }
                return el.getAttribute(attr) ?? '';
              }, action.attribute ?? 'text');
            } else {
              extractedValue = await pptr.evaluate(() => document.title);
            }
            tracker.markAction(tExtractStart, performance.now());

            if (action.as) {
              variables[action.as] = extractedValue;
            }
            break;
          }

          case 'evaluate': {
            if (!action.script) {
              throw new Error('evaluate action requires script');
            }
            const tEvalStart = performance.now();
            extractedValue = await pptr.evaluate(action.script);
            tracker.markAction(tEvalStart, performance.now());
            if (action.as) {
              variables[action.as] = extractedValue;
            }
            break;
          }

          case 'assert': {
            if (!action.assertion) {
              throw new Error('assert action requires assertion');
            }
            const tAssertStart = performance.now();
            await this.executeAssertion(page, action.assertion, variables);
            tracker.markAction(tAssertStart, performance.now());
            break;
          }

          case 'capture': {
            extractedValue = {
              url: pptr.url(),
              title: await pptr.title(),
            };
            if (action.as) {
              variables[action.as] = extractedValue;
            }
            break;
          }

          default:
            throw new Error(`Unsupported action type: ${String(action.type)}`);
        }

        return extractedValue;
      },
    );

    const perfLog = tracker.format();
    const durationMs = Date.now() - startMs;

    return {
      id: action.id,
      type: action.type,
      success: recoveryResult.success,
      durationMs,
      extracted: recoveryResult.result,
      error: recoveryResult.error,
      errorCode: recoveryResult.errorCode,
      perfLog,
    };
  }

  private static getDefaultWaitPolicy(type: string): WaitPolicy {
    switch (type) {
      case 'navigate':
        return 'navigation';
      case 'fill':
      case 'type':
      case 'press_key':
      case 'hover':
      case 'scroll':
      case 'select':
      case 'check':
      case 'uncheck':
      case 'upload':
      case 'drag':
      case 'extract':
      case 'evaluate':
      case 'assert':
      case 'capture':
      case 'click':
      case 'dblclick':
      default:
        return 'action-complete';
    }
  }

  private static async applyWaitPolicy(
    page: ContextPage,
    policy: WaitPolicy,
    action: ActionItem,
    tracker: LatencyTracker,
  ): Promise<void> {
    if (policy === 'action-complete') {
      return;
    }

    const pptr = page.pptrPage;
    const timeout = action.timeoutMs ?? 5000;
    const tWaitStart = performance.now();

    switch (policy) {
      case 'element-visible': {
        if (action.target?.css) {
          await pptr.waitForSelector(action.target.css, {
            visible: true,
            timeout,
          });
        }
        break;
      }

      case 'element-hidden': {
        if (action.target?.css) {
          await pptr.waitForSelector(action.target.css, {
            hidden: true,
            timeout,
          });
        }
        break;
      }

      case 'url-match': {
        const urlPattern = action.waitUrl ?? action.condition?.urlPattern;
        if (urlPattern) {
          const pattern = new RegExp(urlPattern);
          if (!pattern.test(pptr.url())) {
            await pptr.waitForFunction(
              regStr => new RegExp(regStr).test(window.location.href),
              {timeout},
              urlPattern,
            );
          }
        }
        break;
      }

      case 'dom-stable': {
        await page.waitForEventsAfterAction(async () => {}, {
          waitForStableDom: true,
        });
        break;
      }

      case 'custom-condition': {
        if (action.condition) {
          await EventWaiter.waitForCondition(page, action.condition);
        }
        break;
      }

      default:
        break;
    }

    tracker.markDomWait(tWaitStart, performance.now());
  }

  private static async executeAssertion(
    page: ContextPage,
    assertion: AssertCondition,
    variables: Record<string, unknown>,
  ): Promise<void> {
    const pptr = page.pptrPage;

    if (assertion.kind === 'nonEmpty' && assertion.valueRef) {
      const val = variables[assertion.valueRef];
      if (val === undefined || val === null || val === '') {
        throw new Error(
          `Assertion failed: valueRef "${assertion.valueRef}" is empty or undefined`,
        );
      }
      return;
    }

    if (assertion.kind === 'equals' && assertion.valueRef) {
      const val = String(variables[assertion.valueRef] ?? '');
      if (val !== assertion.expected) {
        throw new Error(
          `Assertion failed: value "${val}" does not equal expected "${assertion.expected}"`,
        );
      }
      return;
    }

    if (assertion.target?.css) {
      const selector = assertion.target.css;
      const exists = await pptr.evaluate(
        sel => document.querySelector(sel) !== null,
        selector,
      );

      if (assertion.kind === 'exists' && !exists) {
        throw new Error(
          `Assertion failed: element "${selector}" does not exist`,
        );
      }
      if (assertion.kind === 'notExists' && exists) {
        throw new Error(
          `Assertion failed: element "${selector}" unexpectedly exists`,
        );
      }
    }
  }

  /**
   * Executes a sequential batch of actions against the selected page
   * with multi-action in-page DOM fusion for sub-millisecond execution.
   */
  static async executeBatch(
    ctx: ExecutionContext,
    actions: ActionItem[],
  ): Promise<ActionResult[]> {
    const res = await this.executeBatchWithObservation(ctx, actions);
    return res.results;
  }

  static async executeBatchWithObservation(
    ctx: ExecutionContext,
    actions: ActionItem[],
    options?: {observeAfter?: boolean; limit?: number},
  ): Promise<BatchResultWithObservation> {
    const results: ActionResult[] = [];
    const pptr = ctx.page.pptrPage;
    let observed: BatchResultWithObservation['observation'] = undefined;

    // Initialize page focus once at start of batch, never inside the loop
    await ctx.page.init({emulateFocus: true});

    let i = 0;
    while (i < actions.length) {
      if (ctx.signal?.aborted) {
        results.push({
          id: actions[i]?.id,
          type: actions[i]?.type ?? 'unknown',
          success: false,
          durationMs: 0,
          error: 'Execution cancelled',
          errorCode: HyperErrorCode.CANCELLED,
        });
        break;
      }

      const currentAction = actions[i];
      if (!currentAction) {
        i++;
        continue;
      }

      // Check if we can batch consecutive in-page DOM actions
      if (isDomAction(currentAction)) {
        const domSlice: ActionItem[] = [];
        let j = i;
        while (j < actions.length) {
          const candidate = actions[j];
          if (candidate && isDomAction(candidate)) {
            domSlice.push(candidate);
            j++;
          } else {
            break;
          }
        }

        const isFinalSlice = j === actions.length;
        const wantObserve = Boolean(options?.observeAfter && isFinalSlice);

        if (domSlice.length > 1 || wantObserve) {
          const tBatchStart = performance.now();
          const specs = domSlice.map(toDomActionSpec);
          try {
            const evalRaw = await pptr.evaluate(
              runInPageDomBatch,
              specs,
              wantObserve
                ? {observeAfter: true, limit: options?.limit ?? 25}
                : undefined,
            );
            const domResults = Array.isArray(evalRaw)
              ? evalRaw
              : isDomBatchPayload(evalRaw)
                ? evalRaw.results
                : [];
            if (isDomBatchPayload(evalRaw) && evalRaw.observation) {
              observed = evalRaw.observation;
            }

            let sliceSuccess = true;
            for (let k = 0; k < domSlice.length; k++) {
              const act = domSlice[k];
              const domRes = domResults[k];
              if (act && domRes?.success) {
                results.push({
                  id: act.id,
                  type: act.type,
                  success: true,
                  durationMs: Math.round(performance.now() - tBatchStart),
                  extracted: domRes.extracted,
                });
              } else if (act) {
                sliceSuccess = false;
                const fallbackRes = await this.executeAction(ctx, act);
                results.push(fallbackRes);
                if (!fallbackRes.success && !act.continueOnError) {
                  break;
                }
              }
            }
            if (!sliceSuccess && !currentAction.continueOnError) {
              break;
            }
            i = j;
            continue;
          } catch {
            // Fall through to execute single action if batch evaluate throws
          }
        }
      }

      const res = await this.executeAction(ctx, currentAction);
      results.push(res);
      if (!res.success && !currentAction.continueOnError) {
        break;
      }
      i++;
    }

    return {results, observation: observed};
  }
}

export interface BatchResultWithObservation {
  results: ActionResult[];
  observation?: {
    title: string;
    url: string;
    elements: unknown;
  };
}
