/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type {ContextPage} from '../tools/ToolDefinition.js';
import {LocatorResolver} from './LocatorResolver.js';
import {HyperErrorCode, type WaitCondition} from './types.js';

export class WaitConditionError extends Error {
  readonly code: HyperErrorCode;

  constructor(message: string, code: HyperErrorCode = HyperErrorCode.TIMEOUT) {
    super(message);
    this.name = 'WaitConditionError';
    this.code = code;
  }
}

export class EventWaiter {
  static async waitForCondition(
    page: ContextPage,
    condition: WaitCondition,
  ): Promise<void> {
    const timeout = condition.timeoutMs ?? 5000;
    const pptr = page.pptrPage;

    try {
      switch (condition.kind) {
        case 'elementVisible': {
          if (condition.target?.css) {
            await pptr.waitForSelector(condition.target.css, {
              visible: true,
              timeout,
            });
            return;
          }
          if (condition.target) {
            const locator = LocatorResolver.resolveLocator(
              page,
              condition.target,
            );
            if (locator) {
              await locator.setTimeout(timeout).wait();
              return;
            }
          }
          throw new WaitConditionError(
            'elementVisible condition requires target with css or semantic locator',
            HyperErrorCode.VALIDATION_ERROR,
          );
        }

        case 'elementHidden': {
          if (condition.target?.css) {
            await pptr.waitForSelector(condition.target.css, {
              hidden: true,
              timeout,
            });
            return;
          }
          throw new WaitConditionError(
            'elementHidden condition requires target with css',
            HyperErrorCode.VALIDATION_ERROR,
          );
        }

        case 'elementAttached': {
          if (condition.target?.css) {
            await pptr.waitForSelector(condition.target.css, {
              timeout,
            });
            return;
          }
          throw new WaitConditionError(
            'elementAttached condition requires target with css',
            HyperErrorCode.VALIDATION_ERROR,
          );
        }

        case 'elementDetached': {
          if (condition.target?.css) {
            const selector = condition.target.css;
            await pptr.waitForFunction(
              sel => document.querySelector(sel) === null,
              {timeout},
              selector,
            );
            return;
          }
          throw new WaitConditionError(
            'elementDetached condition requires target with css',
            HyperErrorCode.VALIDATION_ERROR,
          );
        }

        case 'urlMatched': {
          if (!condition.urlPattern) {
            throw new WaitConditionError(
              'urlMatched requires urlPattern',
              HyperErrorCode.VALIDATION_ERROR,
            );
          }
          const pattern = new RegExp(condition.urlPattern);
          if (pattern.test(pptr.url())) {
            return;
          }
          await pptr.waitForFunction(
            regexStr => new RegExp(regexStr).test(window.location.href),
            {timeout},
            condition.urlPattern,
          );
          return;
        }

        case 'textChanged': {
          if (!condition.text) {
            throw new WaitConditionError(
              'textChanged requires text',
              HyperErrorCode.VALIDATION_ERROR,
            );
          }
          const text = condition.text;
          await pptr.waitForFunction(
            expected => document.body.innerText.includes(expected),
            {timeout},
            text,
          );
          return;
        }

        case 'networkResponse': {
          if (!condition.urlPattern) {
            throw new WaitConditionError(
              'networkResponse requires urlPattern',
              HyperErrorCode.VALIDATION_ERROR,
            );
          }
          const pattern = new RegExp(condition.urlPattern);
          await pptr.waitForResponse(resp => pattern.test(resp.url()), {
            timeout,
          });
          return;
        }

        case 'jsPredicate': {
          if (!condition.predicate) {
            throw new WaitConditionError(
              'jsPredicate requires predicate script',
              HyperErrorCode.VALIDATION_ERROR,
            );
          }
          const fn = new Function(`return (${condition.predicate});`);
          await pptr.waitForFunction(() => Boolean(fn()), {timeout});
          return;
        }

        case 'dialogAppeared': {
          if (page.getDialog()) {
            return;
          }
          await new Promise<void>((resolve, reject) => {
            const timer = setTimeout(() => {
              pptr.off('dialog', handler);
              reject(
                new WaitConditionError(
                  'Timed out waiting for dialog to appear',
                  HyperErrorCode.TIMEOUT,
                ),
              );
            }, timeout);

            const handler = (): void => {
              clearTimeout(timer);
              resolve();
            };
            pptr.once('dialog', handler);
          });
          return;
        }

        case 'navigationCommitted': {
          await pptr.waitForNavigation({timeout});
          return;
        }

        case 'downloadCompleted': {
          await new Promise(r => setTimeout(r, Math.min(timeout, 1000)));
          return;
        }

        default:
          throw new WaitConditionError(
            `Unsupported wait condition kind: ${String(condition.kind)}`,
            HyperErrorCode.VALIDATION_ERROR,
          );
      }
    } catch (err) {
      if (err instanceof WaitConditionError) {
        throw err;
      }
      const message = err instanceof Error ? err.message : String(err);
      throw new WaitConditionError(
        `Wait condition failed: ${message}`,
        HyperErrorCode.TIMEOUT,
      );
    }
  }
}
