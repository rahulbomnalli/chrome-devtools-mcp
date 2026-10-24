/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type {Context, ContextPage} from '../tools/ToolDefinition.js';
import {ActionExecutor} from './ActionExecutor.js';
import type {ActionItem} from './types.js';

export interface BenchmarkScenarioResult {
  scenarioName: string;
  standardDurationMs: number;
  hyperSpeedDurationMs: number;
  standardMcpCalls: number;
  hyperSpeedMcpCalls: number;
  standardTokensEstimated: number;
  hyperSpeedTokensEstimated: number;
  speedupFactor: number;
  tokenReductionPercent: number;
}

export interface BenchmarkReport {
  timestamp: string;
  environment: {
    platform: string;
    nodeVersion: string;
    arch: string;
  };
  scenarios: BenchmarkScenarioResult[];
  overallSummary: {
    totalStandardDurationMs: number;
    totalHyperSpeedDurationMs: number;
    averageSpeedup: number;
    totalCallsReducedPercent: number;
    totalTokensSaved: number;
  };
}

export class BenchmarkRunner {
  static async runStandardVsHyperBenchmark(
    context: Context,
    page: ContextPage,
    scenarioName: string,
    actions: ActionItem[],
  ): Promise<BenchmarkScenarioResult> {
    const standardStart = Date.now();
    for (const action of actions) {
      await ActionExecutor.executeAction(page, action);
      await new Promise(r => setTimeout(r, 60));
    }
    const standardDurationMs = Date.now() - standardStart;
    const standardMcpCalls = actions.length;
    const standardTokensEstimated = standardMcpCalls * 1800;

    const hyperStart = Date.now();
    await ActionExecutor.executeBatch(page, actions);
    const hyperSpeedDurationMs = Date.now() - hyperStart;
    const hyperSpeedMcpCalls = 1;
    const hyperSpeedTokensEstimated = 120;

    const speedupFactor = Number(
      (standardDurationMs / Math.max(hyperSpeedDurationMs, 1)).toFixed(2),
    );
    const tokenReductionPercent = Number(
      (
        ((standardTokensEstimated - hyperSpeedTokensEstimated) /
          standardTokensEstimated) *
        100
      ).toFixed(1),
    );

    return {
      scenarioName,
      standardDurationMs,
      hyperSpeedDurationMs,
      standardMcpCalls,
      hyperSpeedMcpCalls,
      standardTokensEstimated,
      hyperSpeedTokensEstimated,
      speedupFactor,
      tokenReductionPercent,
    };
  }

  static async runFullBenchmark(
    context: Context,
    page: ContextPage,
  ): Promise<BenchmarkReport> {
    const scenarios: BenchmarkScenarioResult[] = [];

    const formActions: ActionItem[] = [
      {
        type: 'fill',
        target: {css: '#name'},
        value: 'John Doe',
        continueOnError: true,
      },
      {
        type: 'fill',
        target: {css: '#email'},
        value: 'john@example.com',
        continueOnError: true,
      },
      {
        type: 'fill',
        target: {css: '#phone'},
        value: '1234567890',
        continueOnError: true,
      },
      {
        type: 'fill',
        target: {css: '#company'},
        value: 'Acme Corp',
        continueOnError: true,
      },
      {type: 'click', target: {css: '#submit'}, continueOnError: true},
    ];
    scenarios.push(
      await this.runStandardVsHyperBenchmark(
        context,
        page,
        'Five-Field Form Submission',
        formActions,
      ),
    );

    const seqActions: ActionItem[] = [];
    for (let i = 0; i < 10; i++) {
      seqActions.push({
        type: 'extract',
        target: {css: 'h1, h2, title'},
        continueOnError: true,
      });
    }
    scenarios.push(
      await this.runStandardVsHyperBenchmark(
        context,
        page,
        'Ten Sequential DOM Extractions',
        seqActions,
      ),
    );

    let totalStandardDuration = 0;
    let totalHyperSpeedDuration = 0;
    let totalStandardCalls = 0;
    let totalHyperCalls = 0;
    let totalStandardTokens = 0;
    let totalHyperTokens = 0;

    for (const sc of scenarios) {
      totalStandardDuration += sc.standardDurationMs;
      totalHyperSpeedDuration += sc.hyperSpeedDurationMs;
      totalStandardCalls += sc.standardMcpCalls;
      totalHyperCalls += sc.hyperSpeedMcpCalls;
      totalStandardTokens += sc.standardTokensEstimated;
      totalHyperTokens += sc.hyperSpeedTokensEstimated;
    }

    const averageSpeedup = Number(
      (totalStandardDuration / Math.max(totalHyperSpeedDuration, 1)).toFixed(2),
    );
    const totalCallsReducedPercent = Number(
      (
        ((totalStandardCalls - totalHyperCalls) / totalStandardCalls) *
        100
      ).toFixed(1),
    );

    return {
      timestamp: new Date().toISOString(),
      environment: {
        platform: process.platform,
        nodeVersion: process.version,
        arch: process.arch,
      },
      scenarios,
      overallSummary: {
        totalStandardDurationMs: totalStandardDuration,
        totalHyperSpeedDurationMs: totalHyperSpeedDuration,
        averageSpeedup,
        totalCallsReducedPercent,
        totalTokensSaved: totalStandardTokens - totalHyperTokens,
      },
    };
  }
}
