/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type {ContextPage} from '../tools/ToolDefinition.js';
import {ConsoleManager} from './ConsoleManager.js';
import {NetworkManager} from './NetworkManager.js';

export interface DiagnosticBundle {
  url: string;
  title: string;
  domExcerpt: string;
  consoleErrors: Array<{type: string; text: string; count: number}>;
  failedNetworkRequests: Array<{
    url: string;
    method: string;
    status?: number;
    durationMs?: number;
  }>;
  screenshotPath?: string;
  timestamp: number;
}

export class DiagnosticManager {
  static async captureBundle(
    page: ContextPage,
    options: {
      domSelector?: string;
      screenshotPath?: string;
    } = {},
  ): Promise<DiagnosticBundle> {
    const pptr = page.pptrPage;
    const url = pptr.url();
    const title = await pptr.title();

    // Capture DOM excerpt
    const selector = options.domSelector ?? 'body';
    const domExcerpt = await pptr.evaluate(sel => {
      const el = document.querySelector(sel);
      if (!el) {
        return '(target element not found)';
      }
      return el.innerHTML.slice(0, 1500);
    }, selector);

    // Capture console errors
    const consoleErrors = ConsoleManager.getFilteredMessages(page.id, {
      types: ['error'],
      limit: 10,
    }).map(e => ({
      type: e.type,
      text: e.text,
      count: e.count,
    }));

    // Capture failed network requests
    const networkRequests = NetworkManager.getFilteredRequests(page.id, {
      limit: 20,
    });
    const failedNetworkRequests = networkRequests
      .filter(r => r.status && r.status >= 400)
      .map(r => ({
        url: r.url,
        method: r.method,
        status: r.status,
        durationMs: r.durationMs,
      }));

    let screenshotPath: string | undefined;
    if (options.screenshotPath) {
      await pptr.screenshot({path: options.screenshotPath});
      screenshotPath = options.screenshotPath;
    }

    return {
      url,
      title,
      domExcerpt,
      consoleErrors,
      failedNetworkRequests,
      screenshotPath,
      timestamp: Date.now(),
    };
  }
}
