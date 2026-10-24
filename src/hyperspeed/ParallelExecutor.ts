/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type {Context, ContextPage} from '../tools/ToolDefinition.js';
import {ActionExecutor, type ActionResult} from './ActionExecutor.js';
import type {ActionItem} from './types.js';

export interface ParallelTask {
  id: string;
  pageId?: number;
  actions: ActionItem[];
}

export interface ParallelTaskResult {
  taskId: string;
  pageId?: number;
  success: boolean;
  durationMs: number;
  results: ActionResult[];
  error?: string;
}

export interface ParallelExecutionSummary {
  ok: boolean;
  totalTasks: number;
  completedTasks: number;
  failedTasks: number;
  durationMs: number;
  tasks: ParallelTaskResult[];
}

export class ParallelExecutor {
  static async executeTasks(
    context: Context,
    tasks: ParallelTask[],
    maxConcurrency = 3,
  ): Promise<ParallelExecutionSummary> {
    const startTime = Date.now();
    const taskResults: ParallelTaskResult[] = [];

    let completedTasks = 0;
    let failedTasks = 0;

    const poolSize = Math.max(1, Math.min(maxConcurrency, 5));
    for (let i = 0; i < tasks.length; i += poolSize) {
      const chunk = tasks.slice(i, i + poolSize);
      const chunkPromises = chunk.map(async task => {
        const taskStart = Date.now();
        let page: ContextPage | undefined;

        if (task.pageId !== undefined) {
          page = context.getPageById(task.pageId);
        } else {
          page = context.getSelectedMcpPage();
        }

        if (!page) {
          return {
            taskId: task.id,
            pageId: task.pageId,
            success: false,
            durationMs: Date.now() - taskStart,
            results: [],
            error: `Page ${task.pageId ?? 'selected'} not found`,
          };
        }

        try {
          await page.init({emulateFocus: true});
          const actionResults = await ActionExecutor.executeBatch(
            page,
            task.actions,
          );
          const allOk = actionResults.every(r => r.success);
          return {
            taskId: task.id,
            pageId: page.id,
            success: allOk,
            durationMs: Date.now() - taskStart,
            results: actionResults,
          };
        } catch (err) {
          return {
            taskId: task.id,
            pageId: page.id,
            success: false,
            durationMs: Date.now() - taskStart,
            results: [],
            error: err instanceof Error ? err.message : String(err),
          };
        }
      });

      const chunkResults = await Promise.all(chunkPromises);
      for (const res of chunkResults) {
        if (res.success) {
          completedTasks++;
        } else {
          failedTasks++;
        }
        taskResults.push(res);
      }
    }

    return {
      ok: failedTasks === 0,
      totalTasks: tasks.length,
      completedTasks,
      failedTasks,
      durationMs: Date.now() - startTime,
      tasks: taskResults,
    };
  }
}
