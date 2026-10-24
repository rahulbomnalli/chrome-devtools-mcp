/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import type {ContextPage} from '../tools/ToolDefinition.js';

export interface BulkExtractOptions {
  itemSelector: string;
  fieldSelectors?: Record<string, string>;
  maxItems?: number;
  paginationSelector?: string;
  maxPages?: number;
  infiniteScroll?: boolean;
  scrollRounds?: number;
  exportPath?: string;
}

export interface BulkExtractResult {
  totalExtracted: number;
  items: Array<Record<string, string>>;
  exportFilePath?: string;
  pagesScraped: number;
}

export class BulkExtractor {
  static async extract(
    page: ContextPage,
    options: BulkExtractOptions,
  ): Promise<BulkExtractResult> {
    const pptr = page.pptrPage;
    const maxItems = options.maxItems ?? 100;
    const maxPages = options.maxPages ?? 1;
    const allItems: Array<Record<string, string>> = [];
    const seenSignatures = new Set<string>();

    let currentPage = 0;

    while (currentPage < maxPages && allItems.length < maxItems) {
      currentPage++;

      // Handle infinite scroll if requested
      if (options.infiniteScroll) {
        const rounds = options.scrollRounds ?? 3;
        for (let r = 0; r < rounds; r++) {
          await pptr.mouse.wheel({deltaX: 0, deltaY: 800});
          await new Promise(res => setTimeout(res, 200));
        }
      }

      // Extract items from current page
      const pageItems = await pptr.$$eval(
        options.itemSelector,
        (elements, fields) => {
          return elements.map(el => {
            const item: Record<string, string> = {};
            if (fields && Object.keys(fields).length > 0) {
              for (const [key, selector] of Object.entries(fields)) {
                const target = el.querySelector(selector);
                item[key] = target?.textContent?.trim() ?? '';
              }
            } else {
              item['text'] = el.textContent?.trim() ?? '';
            }
            return item;
          });
        },
        options.fieldSelectors ?? {},
      );

      for (const item of pageItems) {
        const sig = JSON.stringify(item);
        if (!seenSignatures.has(sig)) {
          seenSignatures.add(sig);
          allItems.push(item);
          if (allItems.length >= maxItems) {
            break;
          }
        }
      }

      // Check if pagination selector exists
      if (
        options.paginationSelector &&
        currentPage < maxPages &&
        allItems.length < maxItems
      ) {
        const nextBtn = await pptr.$(options.paginationSelector);
        if (nextBtn) {
          await nextBtn.click();
          await new Promise(res => setTimeout(res, 500));
        } else {
          break;
        }
      } else {
        break;
      }
    }

    let exportFilePath: string | undefined;
    if (options.exportPath) {
      const resolved = path.resolve(options.exportPath);
      await fs.mkdir(path.dirname(resolved), {recursive: true});
      if (resolved.endsWith('.csv')) {
        const headers =
          options.fieldSelectors &&
          Object.keys(options.fieldSelectors).length > 0
            ? Object.keys(options.fieldSelectors)
            : ['text'];
        const csvLines = [headers.join(',')];
        for (const item of allItems) {
          const row = headers.map(h => {
            const val = (item[h] ?? '').replace(/"/g, '""');
            return `"${val}"`;
          });
          csvLines.push(row.join(','));
        }
        await fs.writeFile(resolved, csvLines.join('\n'), 'utf-8');
      } else {
        await fs.writeFile(
          resolved,
          JSON.stringify(allItems, null, 2),
          'utf-8',
        );
      }
      exportFilePath = resolved;
    }

    return {
      totalExtracted: allItems.length,
      items: allItems.slice(0, 100),
      exportFilePath,
      pagesScraped: currentPage,
    };
  }
}
