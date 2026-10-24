/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type {ConsoleMessage} from '../third_party/index.js';
import type {ContextPage} from '../tools/ToolDefinition.js';

export interface ConsoleLogEntry {
  type: string;
  text: string;
  timestamp: number;
  count: number;
}

export interface ConsoleWatchFilter {
  types?: string[];
  pattern?: string;
  limit?: number;
}

export class ConsoleManager {
  static #ringBuffers = new Map<number, ConsoleLogEntry[]>();
  static #maxBufferSize = 100;

  static initMonitoring(page: ContextPage): void {
    if (this.#ringBuffers.has(page.id)) {
      return;
    }

    const buffer: ConsoleLogEntry[] = [];
    this.#ringBuffers.set(page.id, buffer);

    const pptr = page.pptrPage;

    pptr.on('console', (msg: ConsoleMessage) => {
      const type = msg.type();
      const text = msg.text();

      // Deduplicate if identical to previous message
      const last = buffer[buffer.length - 1];
      if (last && last.type === type && last.text === text) {
        last.count++;
        last.timestamp = Date.now();
        return;
      }

      if (buffer.length >= this.#maxBufferSize) {
        buffer.shift();
      }

      buffer.push({
        type,
        text,
        timestamp: Date.now(),
        count: 1,
      });
    });
  }

  static getFilteredMessages(
    pageId: number,
    filter: ConsoleWatchFilter = {},
  ): ConsoleLogEntry[] {
    const buffer = this.#ringBuffers.get(pageId) ?? [];
    let filtered = buffer;

    if (filter.types && filter.types.length > 0) {
      const types = new Set(filter.types.map(t => t.toLowerCase()));
      filtered = filtered.filter(item => types.has(item.type.toLowerCase()));
    }

    if (filter.pattern) {
      const regex = new RegExp(filter.pattern, 'i');
      filtered = filtered.filter(item => regex.test(item.text));
    }

    const limit = filter.limit ?? 50;
    return filtered.slice(-limit);
  }
}
