/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {logger} from '../utils/logger.js';

export interface PerfMarks {
  planId?: string;
  stepId?: string;
  actionType?: string;
  tQueueStart?: number;
  tQueueEnd?: number;
  tResolveStart?: number;
  tResolveEnd?: number;
  tActionStart?: number;
  tActionEnd?: number;
  tNavProbeStart?: number;
  tNavProbeEnd?: number;
  tDomWaitStart?: number;
  tDomWaitEnd?: number;
  tSnapshotStart?: number;
  tSnapshotEnd?: number;
  tStart: number;
}

export class LatencyTracker {
  private marks: PerfMarks;

  constructor(planId?: string, stepId?: string, actionType?: string) {
    this.marks = {
      planId,
      stepId,
      actionType,
      tStart: performance.now(),
    };
  }

  markQueue(start: number, end: number): void {
    this.marks.tQueueStart = start;
    this.marks.tQueueEnd = end;
  }

  markResolve(start: number, end: number): void {
    this.marks.tResolveStart = start;
    this.marks.tResolveEnd = end;
  }

  markAction(start: number, end: number): void {
    this.marks.tActionStart = start;
    this.marks.tActionEnd = end;
  }

  markNavProbe(start: number, end: number): void {
    this.marks.tNavProbeStart = start;
    this.marks.tNavProbeEnd = end;
  }

  markDomWait(start: number, end: number): void {
    this.marks.tDomWaitStart = start;
    this.marks.tDomWaitEnd = end;
  }

  markSnapshot(start: number, end: number): void {
    this.marks.tSnapshotStart = start;
    this.marks.tSnapshotEnd = end;
  }

  private diff(start?: number, end?: number): number {
    if (start === undefined || end === undefined) {
      return 0;
    }
    return Math.max(0, Math.round((end - start) * 10) / 10);
  }

  format(): string {
    const totalMs =
      Math.round((performance.now() - this.marks.tStart) * 10) / 10;
    const queueMs = this.diff(this.marks.tQueueStart, this.marks.tQueueEnd);
    const resolveMs = this.diff(
      this.marks.tResolveStart,
      this.marks.tResolveEnd,
    );
    const actionMs = this.diff(this.marks.tActionStart, this.marks.tActionEnd);
    const navProbeMs = this.diff(
      this.marks.tNavProbeStart,
      this.marks.tNavProbeEnd,
    );
    const domWaitMs = this.diff(
      this.marks.tDomWaitStart,
      this.marks.tDomWaitEnd,
    );
    const snapshotMs = this.diff(
      this.marks.tSnapshotStart,
      this.marks.tSnapshotEnd,
    );

    const plan = this.marks.planId ?? 'act';
    const step = this.marks.stepId ?? this.marks.actionType ?? '1';

    const logLine =
      `[HYPER PERF] plan=${plan} step=${step} queue=${queueMs}ms ` +
      `resolve=${resolveMs}ms action=${actionMs}ms navProbe=${navProbeMs}ms ` +
      `domWait=${domWaitMs}ms snapshot=${snapshotMs}ms total=${totalMs}ms`;

    // Write to stderr or logger so standard JSON-RPC stdout is never corrupted
    try {
      logger?.(logLine);
      if (process.env['HYPER_PERF'] === '1' || process.env['DEBUG']) {
        process.stderr.write(`${logLine}\n`);
      }
    } catch {
      // Ignore logging failures
    }

    return logLine;
  }
}
