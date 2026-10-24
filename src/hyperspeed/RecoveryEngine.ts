/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type {ContextPage} from '../tools/ToolDefinition.js';
import {LocatorResolutionError} from './LocatorResolver.js';
import {HyperErrorCode, type ActionItem} from './types.js';

export interface RecoveryResult<T> {
  success: boolean;
  result?: T;
  error?: string;
  errorCode: HyperErrorCode;
  recovered: boolean;
  retriesAttempted: number;
}

export class RecoveryEngine {
  static classifyError(error: unknown): HyperErrorCode {
    if (error instanceof LocatorResolutionError) {
      return error.code;
    }
    const message = (
      error instanceof Error ? error.message : String(error)
    ).toLowerCase();

    if (message.includes('timeout') || message.includes('timed out')) {
      return HyperErrorCode.TIMEOUT;
    }
    if (message.includes('stale') || message.includes('detached')) {
      return HyperErrorCode.STALE_ELEMENT;
    }
    if (
      message.includes('not found') ||
      message.includes('failed to find') ||
      message.includes('no element')
    ) {
      return HyperErrorCode.LOCATOR_NOT_FOUND;
    }
    if (message.includes('ambiguous')) {
      return HyperErrorCode.AMBIGUOUS_TARGET;
    }
    if (
      message.includes('target closed') ||
      message.includes('session closed') ||
      message.includes('browser was closed')
    ) {
      return HyperErrorCode.TARGET_CLOSED;
    }
    if (
      message.includes('connection lost') ||
      message.includes('websocket') ||
      message.includes('econnreset')
    ) {
      return HyperErrorCode.CONNECTION_LOST;
    }
    if (message.includes('assert') || message.includes('assertion')) {
      return HyperErrorCode.ASSERTION_FAILED;
    }
    if (message.includes('permission') || message.includes('denied')) {
      return HyperErrorCode.PERMISSION_DENIED;
    }
    if (message.includes('cancel') || message.includes('abort')) {
      return HyperErrorCode.CANCELLED;
    }
    if (message.includes('navigation') || message.includes('net::err')) {
      return HyperErrorCode.NAVIGATION_ERROR;
    }
    return HyperErrorCode.UNKNOWN;
  }

  static isIdempotentAction(action: ActionItem): boolean {
    switch (action.type) {
      case 'navigate':
      case 'wait':
      case 'extract':
      case 'hover':
      case 'scroll':
      case 'assert':
      case 'capture':
      case 'fill':
        return true;
      default:
        return false;
    }
  }

  static async executeWithRecovery<T>(
    page: ContextPage,
    action: ActionItem,
    operation: () => Promise<T>,
    maxRetries = 1,
  ): Promise<RecoveryResult<T>> {
    let attempts = 0;
    let lastError: unknown;

    while (attempts <= maxRetries) {
      try {
        const result = await operation();
        return {
          success: true,
          result,
          errorCode: HyperErrorCode.UNKNOWN,
          recovered: attempts > 0,
          retriesAttempted: attempts,
        };
      } catch (err) {
        lastError = err;
        attempts++;
        const code = this.classifyError(err);

        // Handle open unexpected dialog
        const dialog = page.getDialog();
        if (dialog) {
          try {
            await dialog.dismiss();
            page.clearDialog();
          } catch {
            // Dialog dismiss failure ignored
          }
        }

        // Only retry if idempotent and not a validation error
        if (
          attempts <= maxRetries &&
          this.isIdempotentAction(action) &&
          code !== HyperErrorCode.VALIDATION_ERROR &&
          code !== HyperErrorCode.PERMISSION_DENIED
        ) {
          await new Promise(r => setTimeout(r, 100 * attempts));
          continue;
        }

        return {
          success: false,
          error: err instanceof Error ? err.message : String(err),
          errorCode: code,
          recovered: false,
          retriesAttempted: attempts,
        };
      }
    }

    return {
      success: false,
      error: lastError instanceof Error ? lastError.message : String(lastError),
      errorCode: this.classifyError(lastError),
      recovered: false,
      retriesAttempted: attempts,
    };
  }
}
