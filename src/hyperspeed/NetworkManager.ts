/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import type {HTTPRequest, HTTPResponse} from '../third_party/index.js';
import type {ContextPage} from '../tools/ToolDefinition.js';

export interface NetworkLogEntry {
  id: string;
  url: string;
  method: string;
  resourceType: string;
  status?: number;
  statusText?: string;
  durationMs?: number;
  requestHeaders: Record<string, string>;
  responseHeaders?: Record<string, string>;
  timestamp: number;
}

export interface NetworkWatchFilter {
  urlPattern?: string;
  methods?: string[];
  statusCodes?: number[];
  resourceTypes?: string[];
  limit?: number;
}

export interface InterceptRule {
  urlPattern: string;
  action: 'block' | 'mock' | 'modifyHeaders';
  mockStatus?: number;
  mockBody?: string;
  mockContentType?: string;
  addHeaders?: Record<string, string>;
}

const SENSITIVE_HEADERS = new Set([
  'authorization',
  'cookie',
  'set-cookie',
  'x-api-key',
  'x-auth-token',
  'proxy-authorization',
]);

function redactHeaders(
  headers: Record<string, string>,
): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [key, value] of Object.entries(headers)) {
    if (SENSITIVE_HEADERS.has(key.toLowerCase())) {
      result[key] = '[REDACTED]';
    } else {
      result[key] = value;
    }
  }
  return result;
}

export class NetworkManager {
  static #ringBuffers = new Map<number, NetworkLogEntry[]>();
  static #interceptRules = new Map<number, InterceptRule[]>();
  static #maxBufferSize = 100;

  static initMonitoring(page: ContextPage): void {
    if (this.#ringBuffers.has(page.id)) {
      return;
    }

    const buffer: NetworkLogEntry[] = [];
    this.#ringBuffers.set(page.id, buffer);

    const pptr = page.pptrPage;

    pptr.on('request', (req: HTTPRequest) => {
      const entry: NetworkLogEntry = {
        id: `${page.id}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        url: req.url(),
        method: req.method(),
        resourceType: req.resourceType(),
        requestHeaders: redactHeaders(req.headers()),
        timestamp: Date.now(),
      };

      if (buffer.length >= this.#maxBufferSize) {
        buffer.shift();
      }
      buffer.push(entry);
    });

    pptr.on('response', (resp: HTTPResponse) => {
      const req = resp.request();
      const url = req.url();
      for (let i = buffer.length - 1; i >= 0; i--) {
        const item = buffer[i];
        if (item && item.url === url && item.status === undefined) {
          item.status = resp.status();
          item.statusText = resp.statusText();
          item.responseHeaders = redactHeaders(resp.headers());
          item.durationMs = Date.now() - item.timestamp;
          break;
        }
      }
    });
  }

  static getFilteredRequests(
    pageId: number,
    filter: NetworkWatchFilter = {},
  ): NetworkLogEntry[] {
    const buffer = this.#ringBuffers.get(pageId) ?? [];
    let filtered = buffer;

    if (filter.urlPattern) {
      const regex = new RegExp(filter.urlPattern);
      filtered = filtered.filter(item => regex.test(item.url));
    }

    if (filter.methods && filter.methods.length > 0) {
      const methods = new Set(filter.methods.map(m => m.toUpperCase()));
      filtered = filtered.filter(item =>
        methods.has(item.method.toUpperCase()),
      );
    }

    if (filter.statusCodes && filter.statusCodes.length > 0) {
      const codes = new Set(filter.statusCodes);
      filtered = filtered.filter(item => item.status && codes.has(item.status));
    }

    if (filter.resourceTypes && filter.resourceTypes.length > 0) {
      const types = new Set(filter.resourceTypes.map(t => t.toLowerCase()));
      filtered = filtered.filter(item =>
        types.has(item.resourceType.toLowerCase()),
      );
    }

    const limit = filter.limit ?? 50;
    return filtered.slice(-limit);
  }

  static async exportToFile(
    pageId: number,
    filePath: string,
    filter: NetworkWatchFilter = {},
  ): Promise<{filePath: string; count: number}> {
    const entries = this.getFilteredRequests(pageId, filter);
    const resolvedPath = path.resolve(filePath);
    await fs.mkdir(path.dirname(resolvedPath), {recursive: true});
    await fs.writeFile(resolvedPath, JSON.stringify(entries, null, 2), 'utf-8');
    return {
      filePath: resolvedPath,
      count: entries.length,
    };
  }

  static async setupInterception(
    page: ContextPage,
    rules: InterceptRule[],
  ): Promise<void> {
    this.#interceptRules.set(page.id, rules);
    const pptr = page.pptrPage;

    await pptr.setRequestInterception(true);

    pptr.on('request', async (req: HTTPRequest) => {
      const activeRules = this.#interceptRules.get(page.id) ?? [];
      const url = req.url();

      for (const rule of activeRules) {
        const regex = new RegExp(rule.urlPattern);
        if (regex.test(url)) {
          if (rule.action === 'block') {
            await req.abort('blockedbyclient');
            return;
          }
          if (rule.action === 'mock') {
            await req.respond({
              status: rule.mockStatus ?? 200,
              contentType: rule.mockContentType ?? 'application/json',
              body: rule.mockBody ?? '{}',
            });
            return;
          }
          if (rule.action === 'modifyHeaders' && rule.addHeaders) {
            const headers = {...req.headers(), ...rule.addHeaders};
            await req.continue({headers});
            return;
          }
        }
      }

      await req.continue();
    });
  }
}
