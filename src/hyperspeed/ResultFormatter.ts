/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type {OutputMode} from './types.js';

function isRecord(val: unknown): val is Record<string, unknown> {
  return typeof val === 'object' && val !== null;
}

export class ResultFormatter {
  static formatResult(
    payload: Record<string, unknown>,
    mode: OutputMode = 'compact',
  ): string {
    switch (mode) {
      case 'silent': {
        const minimal: Record<string, unknown> = {
          ok: payload['ok'] ?? true,
        };
        if (payload['planId']) {
          minimal['planId'] = payload['planId'];
        }
        if (payload['pageId']) {
          minimal['pageId'] = payload['pageId'];
        }
        return JSON.stringify(minimal);
      }

      case 'dense': {
        const lines: string[] = [];
        const ok = payload['ok'] !== false;
        const pageId = payload['pageId'];
        const title = payload['page'] ?? payload['title'];
        const url = payload['url'];
        const actionsCount = payload['actionsExecuted'];
        const status = ok ? 'OK' : 'FAIL';

        if (title || url) {
          const idPrefix = pageId !== undefined ? `Page ${pageId}: ` : '';
          lines.push(`[${idPrefix}"${title ?? ''}" | ${url ?? ''}]`);
        }
        if (actionsCount !== undefined) {
          lines.push(`${status}: ${actionsCount} action(s) executed`);
        }

        const elements = payload['elements'];
        if (Array.isArray(elements)) {
          for (const item of elements) {
            if (isRecord(item)) {
              const ref = item['ref'] ? String(item['ref']) : '';
              const tag = item['tag'] ? String(item['tag']) : 'el';
              const rawName =
                item['name'] || item['text'] || item['value'] || '';
              const textVal = rawName ? ` "${String(rawName)}"` : '';
              const sel = item['selector'] ? ` (${item['selector']})` : '';
              lines.push(`${ref} ${tag}${textVal}${sel}`.trim());
            }
          }
        }

        if (lines.length === 0) {
          return JSON.stringify(payload);
        }
        return lines.join('\n');
      }

      case 'compact': {
        // Strip heavy fields and undefined values for minimal tokens
        const compact: Record<string, unknown> = {};
        for (const [key, value] of Object.entries(payload)) {
          if (
            key === 'domExcerpt' ||
            key === 'rawLogs' ||
            key === 'fullSnapshot' ||
            value === undefined
          ) {
            continue;
          }
          compact[key] = value;
        }
        return JSON.stringify(compact);
      }

      case 'debug':
      case 'full':
        return JSON.stringify(payload, null, 2);

      case 'normal':
      default: {
        return JSON.stringify(payload, null, 2);
      }
    }
  }
}
