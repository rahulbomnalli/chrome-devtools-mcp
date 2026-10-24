/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type {OutputMode} from './types.js';

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
