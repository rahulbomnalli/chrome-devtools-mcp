/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import type {ContextPage} from '../tools/ToolDefinition.js';

export interface DownloadVerificationResult {
  completed: boolean;
  filePath?: string;
  fileSizeBytes?: number;
  durationMs: number;
  error?: string;
}

export class DownloadManager {
  static async configureDownloadPath(
    page: ContextPage,
    downloadPath: string,
  ): Promise<string> {
    const resolved = path.resolve(downloadPath);
    await fs.mkdir(resolved, {recursive: true});

    const cdp = await page.pptrPage.createCDPSession();
    await cdp.send('Browser.setDownloadBehavior', {
      behavior: 'allow',
      downloadPath: resolved,
      eventsEnabled: true,
    });

    return resolved;
  }

  static async waitForDownload(
    downloadDir: string,
    options: {
      expectedFilename?: string;
      timeoutMs?: number;
    } = {},
  ): Promise<DownloadVerificationResult> {
    const startTime = Date.now();
    const timeout = options.timeoutMs ?? 15000;
    const resolvedDir = path.resolve(downloadDir);

    while (Date.now() - startTime < timeout) {
      try {
        const files = await fs.readdir(resolvedDir);
        for (const file of files) {
          if (file.endsWith('.crdownload') || file.endsWith('.tmp')) {
            continue;
          }
          if (
            options.expectedFilename &&
            !file.includes(options.expectedFilename)
          ) {
            continue;
          }

          const fullPath = path.join(resolvedDir, file);
          const stats = await fs.stat(fullPath);
          if (stats.size > 0) {
            return {
              completed: true,
              filePath: fullPath,
              fileSizeBytes: stats.size,
              durationMs: Date.now() - startTime,
            };
          }
        }
      } catch {
        // Directory read error ignored during poll
      }

      await new Promise(res => setTimeout(res, 250));
    }

    return {
      completed: false,
      durationMs: Date.now() - startTime,
      error: `Download timed out after ${timeout}ms in ${resolvedDir}`,
    };
  }
}
