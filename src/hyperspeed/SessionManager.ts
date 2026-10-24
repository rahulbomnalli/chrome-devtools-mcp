/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type {Context} from '../tools/ToolDefinition.js';

export interface SessionStatusInfo {
  connected: boolean;
  pagesCount: number;
  pages: Array<{
    id: number;
    url?: string;
  }>;
  memoryUsage: {
    heapUsedBytes: number;
    heapTotalBytes: number;
    rssBytes: number;
  };
  timestamp: number;
}

export class SessionManager {
  static async getStatus(context: Context): Promise<SessionStatusInfo> {
    const memory = process.memoryUsage();
    const pagesInfo: Array<{
      id: number;
      url?: string;
    }> = [];

    let connected = false;
    try {
      const selected = context.getSelectedMcpPage();
      if (selected) {
        connected = true;
        pagesInfo.push({
          id: selected.id,
          url: selected.pptrPage?.url(),
        });
      }
    } catch {
      connected = false;
    }

    return {
      connected,
      pagesCount: pagesInfo.length,
      pages: pagesInfo,
      memoryUsage: {
        heapUsedBytes: memory.heapUsed,
        heapTotalBytes: memory.heapTotal,
        rssBytes: memory.rss,
      },
      timestamp: Date.now(),
    };
  }
}
