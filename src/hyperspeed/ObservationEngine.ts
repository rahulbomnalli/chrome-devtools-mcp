/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type {ContextPage} from '../tools/ToolDefinition.js';
import {ConsoleManager} from './ConsoleManager.js';
import {LocatorResolver} from './LocatorResolver.js';
import type {LocatorTarget} from './types.js';

export type ObservationMode =
  | 'minimal'
  | 'semantic'
  | 'targeted'
  | 'diff'
  | 'full'
  | 'visual'
  | 'diagnostic';

export interface PageObservation {
  pageId: number;
  url: string;
  title: string;
  mode: ObservationMode;
  timestamp: number;
  summary?: string;
  elements?: Array<{
    uid?: string;
    role?: string;
    name?: string;
    tag?: string;
    text?: string;
    value?: string;
    selector?: string;
  }>;
  diff?: {
    added: string[];
    removed: string[];
  };
  diagnostics?: {
    consoleErrors: string[];
    networkFailures: string[];
  };
  screenshotPath?: string;
}

interface CacheEntry {
  url: string;
  title: string;
  timestamp: number;
  elementSignatures: Set<string>;
}

export class ObservationEngine {
  static #cache = new Map<number, CacheEntry>();

  static invalidateCache(pageId: number): void {
    this.#cache.delete(pageId);
  }

  static async observe(
    page: ContextPage,
    mode: ObservationMode = 'minimal',
    options?: {
      target?: LocatorTarget;
      filePath?: string;
    },
  ): Promise<PageObservation> {
    const pptr = page.pptrPage;
    const url = pptr.url();
    const title = await pptr.title();
    const timestamp = Date.now();

    const result: PageObservation = {
      pageId: page.id,
      url,
      title,
      mode,
      timestamp,
    };

    switch (mode) {
      case 'minimal':
      case 'semantic': {
        const limit = mode === 'minimal' ? 25 : 50;
        result.summary = `Page ${page.id}: "${title}" at ${url}`;
        const interactive =
          (await pptr.evaluate((maxItems: number) => {
            const isVisible = (el: Element): boolean => {
              const rect = el.getBoundingClientRect();
              return (
                rect.width > 0 &&
                rect.height > 0 &&
                window.getComputedStyle(el).visibility !== 'hidden'
              );
            };
            const query =
              'button, a[href], input, select, textarea, ' +
              '[role="button"], [role="link"], [contenteditable="true"]';
            const nodes = Array.from(document.querySelectorAll(query)).filter(
              isVisible,
            );
            return nodes.slice(0, maxItems).map(el => {
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
              const name =
                el.getAttribute('aria-label') ||
                el.getAttribute('placeholder') ||
                el.getAttribute('name') ||
                undefined;
              const rawText =
                el.textContent ||
                el.getAttribute('aria-label') ||
                el.getAttribute('placeholder') ||
                '';
              const text = rawText.trim().replace(/\s+/g, ' ').slice(0, 40);
              const val =
                'value' in el && typeof el.value === 'string'
                  ? el.value.slice(0, 30)
                  : undefined;
              return {
                tag: el.tagName.toLowerCase(),
                role,
                name,
                text: text.length > 0 ? text : undefined,
                value: val && val.length > 0 ? val : undefined,
                selector: sel,
              };
            });
          }, limit)) ?? [];
        if (interactive.length > 0) {
          result.elements = interactive;
        }
        return result;
      }

      case 'targeted': {
        if (!options?.target) {
          throw new Error('targeted observation requires target locator');
        }
        if (options.target.css) {
          const selector = options.target.css;
          const content = await pptr.$$eval(selector, els => {
            return els.map(el => ({
              tag: el.tagName.toLowerCase(),
              text: el.textContent?.trim().slice(0, 200),
            }));
          });
          result.elements = content;
        } else {
          using handle = await LocatorResolver.resolveHandle(
            page,
            options.target,
          );
          const data = await handle.evaluate(el => ({
            tag: el.tagName.toLowerCase(),
            text: el.textContent?.trim(),
          }));
          result.elements = [data];
        }
        return result;
      }

      case 'diff': {
        const currentItems = await pptr.evaluate(() => {
          const els = document.querySelectorAll('button, a, input, h1, h2');
          const sigs: string[] = [];
          for (let i = 0; i < els.length; i++) {
            const el = els[i];
            if (el) {
              sigs.push(
                `${el.tagName}:${el.textContent?.trim().slice(0, 50) ?? ''}`,
              );
            }
          }
          return sigs;
        });

        const currentSet = new Set(currentItems);
        const previous = this.#cache.get(page.id);

        if (previous && previous.url === url) {
          const added: string[] = [];
          const removed: string[] = [];
          for (const item of currentSet) {
            if (!previous.elementSignatures.has(item)) {
              added.push(item);
            }
          }
          for (const item of previous.elementSignatures) {
            if (!currentSet.has(item)) {
              removed.push(item);
            }
          }
          result.diff = {added, removed};
        } else {
          result.diff = {
            added: Array.from(currentSet).slice(0, 20),
            removed: [],
          };
        }

        this.#cache.set(page.id, {
          url,
          title,
          timestamp,
          elementSignatures: currentSet,
        });

        return result;
      }

      case 'diagnostic': {
        const errors = ConsoleManager.getFilteredMessages(page.id, {
          types: ['error'],
        }).map(e => e.text);
        result.diagnostics = {
          consoleErrors: errors,
          networkFailures: [],
        };
        return result;
      }

      case 'visual': {
        const filePath = options?.filePath ?? 'page_screenshot.png';
        await pptr.screenshot({
          path: filePath,
        });
        result.screenshotPath = filePath;
        return result;
      }

      case 'full':
      default: {
        result.summary = `Full observation of Page ${page.id}`;
        return result;
      }
    }
  }
}
