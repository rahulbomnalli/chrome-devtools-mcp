/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type {McpContext} from './McpContext.js';
import {McpResponse} from './McpResponse.js';
import type {TextContent, ImageContent} from './third_party/index.js';

export class SlimMcpResponse extends McpResponse {
  override async handle(context: McpContext): Promise<{
    content: Array<TextContent | ImageContent>;
    structuredContent: object;
  }> {
    const error = this.error;
    const lines = [...this.responseLines];
    if (error) {
      lines.push(`Error: ${error.message}`);
    }
    if (this.includePages) {
      const allPages = context.getPages();
      let selectedId: number | undefined;
      try {
        selectedId = context.getSelectedMcpPage().id;
      } catch {
        // none selected
      }
      lines.push('## Pages');
      for (const p of allPages) {
        const isSelected = p.id === selectedId;
        lines.push(
          `${isSelected ? '* ' : '  '}[${p.id}] ${p.url()} (${p.getTitle() || 'Untitled'})`,
        );
      }
    }
    const responseText = lines.join('\n');
    const content: Array<TextContent | ImageContent> = [];
    if (responseText.length > 0) {
      content.push({
        type: 'text',
        text: responseText,
      });
    }
    for (const img of this.images) {
      content.push({
        type: 'image',
        data: img.data,
        mimeType: img.mimeType,
      });
    }
    return {
      content,
      structuredContent: content[0] ?? {type: 'text', text: ''},
    };
  }
}
