/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {ActionExecutor} from '../hyperspeed/ActionExecutor.js';
import {BenchmarkRunner} from '../hyperspeed/BenchmarkRunner.js';
import {BulkExtractor} from '../hyperspeed/BulkExtractor.js';
import {ConsoleManager} from '../hyperspeed/ConsoleManager.js';
import {DiagnosticManager} from '../hyperspeed/DiagnosticManager.js';
import {DownloadManager} from '../hyperspeed/DownloadManager.js';
import {EventWaiter} from '../hyperspeed/EventWaiter.js';
import {NetworkManager} from '../hyperspeed/NetworkManager.js';
import {ParallelExecutor} from '../hyperspeed/ParallelExecutor.js';
import {PlanCompiler} from '../hyperspeed/PlanCompiler.js';
import {PlanExecutor} from '../hyperspeed/PlanExecutor.js';
import {ResultFormatter} from '../hyperspeed/ResultFormatter.js';
import {SessionManager} from '../hyperspeed/SessionManager.js';
import {ObservationEngine} from '../hyperspeed/ObservationEngine.js';
import {
  actionItemSchema,
  networkInterceptRuleSchema,
  outputModeSchema,
  parallelTaskSchema,
  waitConditionSchema,
  workflowStepSchema,
  type LocatorTarget,
  type OutputMode,
  type WaitCondition,
} from '../hyperspeed/types.js';
import {zod} from '../third_party/index.js';
import {ToolCategory} from './categories.js';
import {
  definePageTool,
  defineTool,
  type PageToolFactory,
  type ToolFactory,
} from './ToolDefinition.js';

function parseOutputMode(mode: unknown): OutputMode {
  if (mode === 'silent') {
    return 'silent';
  }
  if (mode === 'normal') {
    return 'normal';
  }
  if (mode === 'debug') {
    return 'debug';
  }
  if (mode === 'full') {
    return 'full';
  }
  return 'compact';
}

function parseJsonObject<T>(input: string | undefined): T | undefined {
  if (!input) {
    return undefined;
  }
  try {
    return JSON.parse(input) as T;
  } catch {
    return undefined;
  }
}

function parseLocatorTarget(
  targetStr: string | undefined,
): LocatorTarget | undefined {
  if (!targetStr) {
    return undefined;
  }
  if (targetStr.startsWith('{')) {
    return parseJsonObject<LocatorTarget>(targetStr);
  }
  return {css: targetStr};
}

export const hyperAct: PageToolFactory = definePageTool(() => ({
  name: 'hyper_act',
  description:
    'PRIMARY HIGH-SPEED ACTION TOOL: Executes one or multiple browser ' +
    'actions (navigate, click, dblclick, fill, type, press_key, hover, ' +
    'scroll, select, check, upload, drag, wait, extract, evaluate, assert, ' +
    'capture) in a single compound turn on the selected page. Targets can be ' +
    'CSS selectors, text="...", or @index refs from hyper_observe. Set ' +
    'observeAfter=true to return the updated page elements in the same turn.',
  annotations: {
    category: ToolCategory.INPUT,
    readOnlyHint: false,
  },
  schema: {
    actions: zod
      .array(actionItemSchema)
      .min(1)
      .describe('List of browser actions to execute sequentially.'),
    observeAfter: zod
      .boolean()
      .optional()
      .describe(
        'If true, automatically scans and returns the updated page elements ' +
          'immediately after actions finish, eliminating an extra observation turn.',
      ),
    outputMode: outputModeSchema.optional(),
  },
  blockedByDialog: false,
  concurrency: 'page',
  verifyFilesSchema: {},
  handler: async (request, response) => {
    const actions = zod.array(actionItemSchema).parse(request.params.actions);
    const mode = parseOutputMode(request.params.outputMode);
    const results = await ActionExecutor.executeBatch(request.page, actions);
    const allSuccess = results.every(r => r.success);
    let page: string | undefined;
    let url: string | undefined;
    let elements: unknown = undefined;
    if (request.params.observeAfter) {
      const observation = await ObservationEngine.observe(
        request.page,
        'minimal',
      );
      page = observation.title;
      url = observation.url;
      elements = observation.elements;
    }
    const formatted = ResultFormatter.formatResult(
      {
        ok: allSuccess,
        pageId: request.page.id,
        actionsExecuted: results.length,
        results,
        page,
        url,
        elements,
      },
      mode,
    );
    response.appendResponseLine(formatted);
  },
}));

export const hyperExecutePlan: ToolFactory = defineTool(() => ({
  name: 'hyper_execute_plan',
  description:
    'PRIMARY WORKFLOW ENGINE: Compiles and executes a complete multi-step, ' +
    'multi-tab workflow plan with step dependencies, variable bindings, and ' +
    'conditional branching in a single MCP call. Use this when the sequence ' +
    'of tasks across tabs or pages is known instead of orchestrating turn-by-turn.',
  annotations: {
    category: ToolCategory.NAVIGATION,
    readOnlyHint: false,
  },
  schema: {
    planId: zod.string().describe('Unique ID for this workflow plan.'),
    steps: zod
      .array(workflowStepSchema)
      .min(1)
      .describe('Workflow steps to execute.'),
    variables: zod
      .string()
      .optional()
      .describe('JSON-formatted initial variable bindings.'),
    timeoutMs: zod.number().optional().describe('Total plan timeout in ms.'),
    maxConcurrency: zod.number().optional().default(3),
    dryRun: zod.boolean().optional().default(false),
    outputMode: outputModeSchema.optional(),
  },
  blockedByDialog: false,
  concurrency: 'exclusive',
  verifyFilesSchema: {},
  handler: async (request, response, context) => {
    const steps = zod.array(workflowStepSchema).parse(request.params.steps);
    const mode = parseOutputMode(request.params.outputMode);
    const parsedVars = parseJsonObject<Record<string, string>>(
      request.params.variables,
    );
    const compiled = PlanCompiler.validateAndCompile({
      planId: String(request.params.planId),
      steps,
      variables: parsedVars,
      timeoutMs: request.params.timeoutMs,
      maxConcurrency: request.params.maxConcurrency,
      dryRun: request.params.dryRun,
    });
    const summary = await PlanExecutor.execute(context, compiled);
    const formatted = ResultFormatter.formatResult(
      {
        ok: summary.ok,
        planId: summary.planId,
        durationMs: summary.durationMs,
        completedSteps: summary.completedSteps,
        failedSteps: summary.failedSteps,
        skippedSteps: summary.skippedSteps,
        data: summary.data,
        errors: summary.errors,
      },
      mode,
    );
    response.appendResponseLine(formatted);
  },
}));

export const hyperParallel: ToolFactory = defineTool(() => ({
  name: 'hyper_parallel',
  description:
    'Executes multiple independent subplans concurrently across different pages.',
  annotations: {
    category: ToolCategory.NAVIGATION,
    readOnlyHint: false,
  },
  schema: {
    tasks: zod.array(parallelTaskSchema).min(1),
    maxConcurrency: zod.number().optional().default(3),
    outputMode: outputModeSchema.optional(),
  },
  blockedByDialog: false,
  concurrency: 'exclusive',
  verifyFilesSchema: {},
  handler: async (request, response, context) => {
    const mode = parseOutputMode(request.params.outputMode);
    const tasks = request.params.tasks.map(t => ({
      id: String(t.id),
      pageId: t.pageId,
      actions: zod.array(actionItemSchema).parse(t.actions),
    }));
    const summary = await ParallelExecutor.executeTasks(
      context,
      tasks,
      request.params.maxConcurrency,
    );
    const formatted = ResultFormatter.formatResult(
      {
        ok: summary.ok,
        totalTasks: summary.totalTasks,
        completedTasks: summary.completedTasks,
        failedTasks: summary.failedTasks,
        durationMs: summary.durationMs,
        tasks: summary.tasks,
      },
      mode,
    );
    response.appendResponseLine(formatted);
  },
}));

export const hyperObserve: PageToolFactory = definePageTool(() => ({
  name: 'hyper_observe',
  description:
    'Optimized selective page observation. Use only when element targets ' +
    'or state are genuinely unknown. Modes: "minimal", "semantic", "targeted", ' +
    '"diff", "visual", "diagnostic". Do NOT call hyper_observe before or between ' +
    'hyper_act actions when targets and expected conditions are already known.',
  annotations: {
    category: ToolCategory.DEBUGGING,
    readOnlyHint: true,
  },
  schema: {
    mode: zod
      .enum([
        'minimal',
        'semantic',
        'targeted',
        'diff',
        'full',
        'visual',
        'diagnostic',
      ])
      .default('minimal'),
    target: zod
      .string()
      .optional()
      .describe(
        'Target CSS selector or JSON locator for targeted observation.',
      ),
    filePath: zod.string().optional(),
    outputMode: outputModeSchema.optional(),
  },
  blockedByDialog: false,
  concurrency: 'page',
  verifyFilesSchema: {},
  handler: async (request, response) => {
    const mode = parseOutputMode(request.params.outputMode);
    const obsMode =
      request.params.mode === 'semantic' ||
      request.params.mode === 'targeted' ||
      request.params.mode === 'diff' ||
      request.params.mode === 'full' ||
      request.params.mode === 'visual' ||
      request.params.mode === 'diagnostic'
        ? request.params.mode
        : 'minimal';

    const target = parseLocatorTarget(request.params.target);

    const observation = await ObservationEngine.observe(request.page, obsMode, {
      target,
      filePath: request.params.filePath,
    });
    const formatted = ResultFormatter.formatResult(
      {
        ok: true,
        pageId: observation.pageId,
        url: observation.url,
        title: observation.title,
        mode: observation.mode,
        summary: observation.summary,
        elements: observation.elements,
        diff: observation.diff,
        diagnostics: observation.diagnostics,
        screenshotPath: observation.screenshotPath,
      },
      mode,
    );
    response.appendResponseLine(formatted);
  },
}));

export const hyperWaitFor: PageToolFactory = definePageTool(() => ({
  name: 'hyper_wait_for',
  description:
    'Event-driven synchronization for DOM, network, and navigation conditions.',
  annotations: {
    category: ToolCategory.NAVIGATION,
    readOnlyHint: true,
  },
  schema: {
    condition: zod
      .string()
      .describe('JSON-formatted wait condition configuration.'),
    outputMode: outputModeSchema.optional(),
  },
  blockedByDialog: false,
  concurrency: 'page',
  verifyFilesSchema: {},
  handler: async (request, response) => {
    const start = Date.now();
    const rawCond = parseJsonObject<WaitCondition>(request.params.condition);
    if (!rawCond) {
      throw new Error('Invalid JSON format for wait condition parameter');
    }
    const cond = waitConditionSchema.parse(rawCond);
    const mode = parseOutputMode(request.params.outputMode);
    await EventWaiter.waitForCondition(request.page, cond);
    const formatted = ResultFormatter.formatResult(
      {
        ok: true,
        pageId: request.page.id,
        kind: cond.kind,
        durationMs: Date.now() - start,
      },
      mode,
    );
    response.appendResponseLine(formatted);
  },
}));

export const hyperBulkExtract: PageToolFactory = definePageTool(() => ({
  name: 'hyper_bulk_extract',
  description:
    'Extracts large structured datasets with pagination, infinite scroll, and CSV/JSON export.',
  annotations: {
    category: ToolCategory.INPUT,
    readOnlyHint: false,
  },
  schema: {
    itemSelector: zod.string().describe('CSS selector for each item element.'),
    fieldSelectors: zod
      .string()
      .optional()
      .describe('JSON-formatted mapping of field name to inner CSS selector.'),
    maxItems: zod.number().optional().default(100),
    paginationSelector: zod.string().optional(),
    maxPages: zod.number().optional().default(1),
    infiniteScroll: zod.boolean().optional().default(false),
    scrollRounds: zod.number().optional().default(3),
    exportPath: zod.string().optional(),
    outputMode: outputModeSchema.optional(),
  },
  blockedByDialog: true,
  concurrency: 'page',
  verifyFilesSchema: {},
  handler: async (request, response) => {
    const mode = parseOutputMode(request.params.outputMode);
    const fieldMap = parseJsonObject<Record<string, string>>(
      request.params.fieldSelectors,
    );
    const result = await BulkExtractor.extract(request.page, {
      itemSelector: request.params.itemSelector,
      fieldSelectors: fieldMap,
      maxItems: request.params.maxItems,
      paginationSelector: request.params.paginationSelector,
      maxPages: request.params.maxPages,
      infiniteScroll: request.params.infiniteScroll,
      scrollRounds: request.params.scrollRounds,
      exportPath: request.params.exportPath,
    });
    const formatted = ResultFormatter.formatResult(
      {
        ok: true,
        pageId: request.page.id,
        totalExtracted: result.totalExtracted,
        pagesScraped: result.pagesScraped,
        exportFilePath: result.exportFilePath,
        itemsSample: result.items.slice(0, 5),
      },
      mode,
    );
    response.appendResponseLine(formatted);
  },
}));

export const hyperDownloadManager: PageToolFactory = definePageTool(() => ({
  name: 'hyper_download_manager',
  description:
    'Configures Chrome download behavior and verifies completed files.',
  annotations: {
    category: ToolCategory.NETWORK,
    readOnlyHint: false,
  },
  schema: {
    action: zod.enum(['configure', 'wait']),
    downloadPath: zod.string().describe('Target download directory.'),
    expectedFilename: zod.string().optional(),
    timeoutMs: zod.number().optional().default(15000),
    outputMode: outputModeSchema.optional(),
  },
  blockedByDialog: false,
  concurrency: 'page',
  verifyFilesSchema: {},
  handler: async (request, response) => {
    const mode = parseOutputMode(request.params.outputMode);
    if (request.params.action === 'configure') {
      const configured = await DownloadManager.configureDownloadPath(
        request.page,
        request.params.downloadPath,
      );
      response.appendResponseLine(
        ResultFormatter.formatResult(
          {ok: true, downloadPath: configured},
          mode,
        ),
      );
    } else {
      const res = await DownloadManager.waitForDownload(
        request.params.downloadPath,
        {
          expectedFilename: request.params.expectedFilename,
          timeoutMs: request.params.timeoutMs,
        },
      );
      response.appendResponseLine(
        ResultFormatter.formatResult(
          {
            ok: res.completed,
            filePath: res.filePath,
            fileSizeBytes: res.fileSizeBytes,
            durationMs: res.durationMs,
            error: res.error,
          },
          mode,
        ),
      );
    }
  },
}));

export const hyperNetworkWatch: PageToolFactory = definePageTool(() => ({
  name: 'hyper_network_watch',
  description:
    'Captures ring-buffered network activity with credential redaction and filtering.',
  annotations: {
    category: ToolCategory.NETWORK,
    readOnlyHint: true,
  },
  schema: {
    urlPattern: zod.string().optional(),
    methods: zod.array(zod.string()).optional(),
    statusCodes: zod.array(zod.number()).optional(),
    resourceTypes: zod.array(zod.string()).optional(),
    limit: zod.number().optional().default(50),
    outputMode: outputModeSchema.optional(),
  },
  blockedByDialog: false,
  concurrency: 'page',
  verifyFilesSchema: {},
  handler: async (request, response) => {
    const mode = parseOutputMode(request.params.outputMode);
    NetworkManager.initMonitoring(request.page);
    const entries = NetworkManager.getFilteredRequests(
      request.page.id,
      request.params,
    );
    response.appendResponseLine(
      ResultFormatter.formatResult(
        {
          ok: true,
          pageId: request.page.id,
          count: entries.length,
          requests: entries,
        },
        mode,
      ),
    );
  },
}));

export const hyperNetworkExport: PageToolFactory = definePageTool(() => ({
  name: 'hyper_network_export',
  description: 'Exports filtered network activity to a structured JSON file.',
  annotations: {
    category: ToolCategory.NETWORK,
    readOnlyHint: false,
  },
  schema: {
    filePath: zod.string().describe('Output file path for the export.'),
    urlPattern: zod.string().optional(),
    methods: zod.array(zod.string()).optional(),
    statusCodes: zod.array(zod.number()).optional(),
    resourceTypes: zod.array(zod.string()).optional(),
    outputMode: outputModeSchema.optional(),
  },
  blockedByDialog: false,
  concurrency: 'page',
  verifyFilesSchema: {
    filePath: true,
  },
  handler: async (request, response) => {
    const mode = parseOutputMode(request.params.outputMode);
    const res = await NetworkManager.exportToFile(
      request.page.id,
      request.params.filePath,
      request.params,
    );
    response.appendResponseLine(
      ResultFormatter.formatResult(
        {
          ok: true,
          pageId: request.page.id,
          filePath: res.filePath,
          recordsExported: res.count,
        },
        mode,
      ),
    );
  },
}));

export const hyperNetworkIntercept: PageToolFactory = definePageTool(() => ({
  name: 'hyper_network_intercept',
  description:
    'Configures scoped network request blocking, mocking, and header modifications.',
  annotations: {
    category: ToolCategory.NETWORK,
    readOnlyHint: false,
  },
  schema: {
    rules: zod.array(networkInterceptRuleSchema),
    outputMode: outputModeSchema.optional(),
  },
  blockedByDialog: false,
  concurrency: 'page',
  verifyFilesSchema: {},
  handler: async (request, response) => {
    const mode = parseOutputMode(request.params.outputMode);
    const rules = request.params.rules.map(r => ({
      urlPattern: r.urlPattern,
      action:
        r.action === 'block' || r.action === 'mock'
          ? r.action
          : ('modifyHeaders' as const),
      mockStatus: r.mockStatus,
      mockBody: r.mockBody,
      mockContentType: r.mockContentType,
      addHeaders: r.addHeaders,
    }));
    await NetworkManager.setupInterception(request.page, rules);
    response.appendResponseLine(
      ResultFormatter.formatResult(
        {
          ok: true,
          pageId: request.page.id,
          rulesApplied: rules.length,
        },
        mode,
      ),
    );
  },
}));

export const hyperConsoleWatch: PageToolFactory = definePageTool(() => ({
  name: 'hyper_console_watch',
  description:
    'Monitors browser console logs with type filtering, regex matching, and deduplication.',
  annotations: {
    category: ToolCategory.DEBUGGING,
    readOnlyHint: true,
  },
  schema: {
    types: zod.array(zod.string()).optional(),
    pattern: zod.string().optional(),
    limit: zod.number().optional().default(50),
    outputMode: outputModeSchema.optional(),
  },
  blockedByDialog: false,
  concurrency: 'page',
  verifyFilesSchema: {},
  handler: async (request, response) => {
    const mode = parseOutputMode(request.params.outputMode);
    ConsoleManager.initMonitoring(request.page);
    const messages = ConsoleManager.getFilteredMessages(
      request.page.id,
      request.params,
    );
    response.appendResponseLine(
      ResultFormatter.formatResult(
        {
          ok: true,
          pageId: request.page.id,
          count: messages.length,
          messages,
        },
        mode,
      ),
    );
  },
}));

export const hyperDebugCapture: PageToolFactory = definePageTool(() => ({
  name: 'hyper_debug_capture',
  description:
    'Captures consolidated diagnostics (DOM excerpt, console errors, failed network, screenshot).',
  annotations: {
    category: ToolCategory.DEBUGGING,
    readOnlyHint: true,
  },
  schema: {
    domSelector: zod.string().optional().default('body'),
    screenshotPath: zod.string().optional(),
    outputMode: outputModeSchema.optional(),
  },
  blockedByDialog: false,
  concurrency: 'page',
  verifyFilesSchema: {},
  handler: async (request, response) => {
    const mode = parseOutputMode(request.params.outputMode);
    const bundle = await DiagnosticManager.captureBundle(
      request.page,
      request.params,
    );
    response.appendResponseLine(
      ResultFormatter.formatResult(
        {
          ok: true,
          pageId: request.page.id,
          url: bundle.url,
          title: bundle.title,
          consoleErrorsCount: bundle.consoleErrors.length,
          consoleErrors: bundle.consoleErrors,
          failedNetworkCount: bundle.failedNetworkRequests.length,
          failedNetworkRequests: bundle.failedNetworkRequests,
          screenshotPath: bundle.screenshotPath,
          domExcerpt: bundle.domExcerpt,
        },
        mode,
      ),
    );
  },
}));

export const hyperRecover: PageToolFactory = definePageTool(() => ({
  name: 'hyper_recover',
  description:
    'Attempts automatic recovery from common browser errors (unexpected dialogs, detached nodes).',
  annotations: {
    category: ToolCategory.DEBUGGING,
    readOnlyHint: false,
  },
  schema: {
    actionType: zod.enum(['dismissDialog', 'reload', 'reconnect']),
    outputMode: outputModeSchema.optional(),
  },
  blockedByDialog: false,
  concurrency: 'page',
  verifyFilesSchema: {},
  handler: async (request, response) => {
    const mode = parseOutputMode(request.params.outputMode);
    let recovered = false;
    if (request.params.actionType === 'dismissDialog') {
      const dialog = request.page.getDialog();
      if (dialog) {
        await dialog.dismiss();
        request.page.clearDialog();
        recovered = true;
      }
    } else if (request.params.actionType === 'reload') {
      await request.page.pptrPage.reload();
      recovered = true;
    }
    response.appendResponseLine(
      ResultFormatter.formatResult(
        {
          ok: recovered,
          action: request.params.actionType,
        },
        mode,
      ),
    );
  },
}));

export const hyperBenchmark: PageToolFactory = definePageTool(() => ({
  name: 'hyper_benchmark',
  description:
    'Runs performance benchmarks comparing standard tools against HyperSpeed execution.',
  annotations: {
    category: ToolCategory.DEBUGGING,
    readOnlyHint: true,
  },
  schema: {
    outputMode: outputModeSchema.optional(),
  },
  blockedByDialog: false,
  concurrency: 'page',
  verifyFilesSchema: {},
  handler: async (request, response, context) => {
    const mode = parseOutputMode(request.params.outputMode);
    const report = await BenchmarkRunner.runFullBenchmark(
      context,
      request.page,
    );
    response.appendResponseLine(
      ResultFormatter.formatResult(
        {
          ok: true,
          report,
        },
        mode,
      ),
    );
  },
}));

export const hyperSessionStatus: ToolFactory = defineTool(() => ({
  name: 'hyper_session_status',
  description:
    'Reports persistent browser connection status, target list, and performance metrics.',
  annotations: {
    category: ToolCategory.DEBUGGING,
    readOnlyHint: true,
  },
  schema: {
    outputMode: outputModeSchema.optional(),
  },
  blockedByDialog: false,
  concurrency: 'exclusive',
  verifyFilesSchema: {},
  handler: async (request, response, context) => {
    const mode = parseOutputMode(request.params.outputMode);
    const status = await SessionManager.getStatus(context);
    response.appendResponseLine(
      ResultFormatter.formatResult(
        {
          ok: true,
          status,
        },
        mode,
      ),
    );
  },
}));
