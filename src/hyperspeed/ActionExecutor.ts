/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type {ContextPage} from '../tools/ToolDefinition.js';
import {
  FastActionExecutor,
  type ActionResult,
  type BatchResultWithObservation,
  type ExecutionContext,
} from './FastActionExecutor.js';
import type {ActionItem} from './types.js';

export {
  type ActionResult,
  type BatchResultWithObservation,
  type ExecutionContext,
};

export class ActionExecutor {
  static async executeAction(
    page: ContextPage,
    action: ActionItem,
    variables: Record<string, unknown> = {},
  ): Promise<ActionResult> {
    return await FastActionExecutor.executeAction(
      {
        page,
        variables,
      },
      action,
    );
  }

  static async executeBatch(
    page: ContextPage,
    actions: ActionItem[],
    variables: Record<string, unknown> = {},
  ): Promise<ActionResult[]> {
    return await FastActionExecutor.executeBatch(
      {
        page,
        variables,
      },
      actions,
    );
  }

  static async executeBatchWithObservation(
    page: ContextPage,
    actions: ActionItem[],
    variables: Record<string, unknown> = {},
    options?: {observeAfter?: boolean; limit?: number},
  ): Promise<BatchResultWithObservation> {
    return await FastActionExecutor.executeBatchWithObservation(
      {
        page,
        variables,
      },
      actions,
      options,
    );
  }
}
