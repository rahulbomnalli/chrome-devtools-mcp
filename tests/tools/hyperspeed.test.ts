/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import assert from 'node:assert';
import {describe, it} from 'node:test';
import sinon from 'sinon';

import {FastActionExecutor} from '../../src/hyperspeed/FastActionExecutor.js';
import {LatencyTracker} from '../../src/hyperspeed/LatencyTracker.js';
import {
  PlanCompiler,
  PlanValidationError,
} from '../../src/hyperspeed/PlanCompiler.js';
import {RecoveryEngine} from '../../src/hyperspeed/RecoveryEngine.js';
import {ResultFormatter} from '../../src/hyperspeed/ResultFormatter.js';
import {HyperErrorCode, locatorSchema} from '../../src/hyperspeed/types.js';
import {
  hyperAct,
  hyperBulkExtract,
  hyperConsoleWatch,
  hyperDebugCapture,
  hyperDownloadManager,
  hyperExecutePlan,
  hyperNetworkWatch,
  hyperObserve,
  hyperParallel,
  hyperRecover,
  hyperSessionStatus,
  hyperWaitFor,
} from '../../src/tools/hyperspeed.js';
import {ToolCategory} from '../../src/tools/categories.js';
import {isAvailableInMode, isFastTool} from '../../src/tools/ToolDefinition.js';
import {createHandlerMocks, createMockCDPSession} from '../mocks.js';

describe('hyperspeed tools', () => {
  describe('PlanCompiler', () => {
    it('detects and rejects dependency cycles', () => {
      assert.throws(
        () => {
          PlanCompiler.validateAndCompile({
            planId: 'cycle-test',
            steps: [
              {id: 'step-a', type: 'navigate', dependsOn: ['step-b']},
              {id: 'step-b', type: 'navigate', dependsOn: ['step-a']},
            ],
          });
        },
        (err: unknown) => {
          return (
            err instanceof PlanValidationError &&
            err.message.includes('Dependency cycle detected')
          );
        },
      );
    });

    it('orders independent steps into concurrent stages', () => {
      const compiled = PlanCompiler.validateAndCompile({
        planId: 'stages-test',
        steps: [
          {id: 'open1', type: 'navigate', pageId: 1},
          {id: 'open2', type: 'navigate', pageId: 2},
          {id: 'extract1', type: 'extract', dependsOn: ['open1'], pageId: 1},
        ],
      });

      assert.strictEqual(compiled.stages.length, 2);
      assert.strictEqual(compiled.stages[0]?.steps.length, 2);
      assert.strictEqual(compiled.stages[1]?.steps.length, 1);
    });
  });

  describe('RecoveryEngine', () => {
    it('classifies error strings into standard error codes', () => {
      assert.strictEqual(
        RecoveryEngine.classifyError(new Error('Navigation timeout exceeded')),
        HyperErrorCode.TIMEOUT,
      );
      assert.strictEqual(
        RecoveryEngine.classifyError(new Error('Node is detached from DOM')),
        HyperErrorCode.STALE_ELEMENT,
      );
      assert.strictEqual(
        RecoveryEngine.classifyError(
          new Error('No element found for selector'),
        ),
        HyperErrorCode.LOCATOR_NOT_FOUND,
      );
    });

    it('identifies idempotent actions', () => {
      assert.strictEqual(
        RecoveryEngine.isIdempotentAction({type: 'navigate'}),
        true,
      );
      assert.strictEqual(
        RecoveryEngine.isIdempotentAction({type: 'extract'}),
        true,
      );
      assert.strictEqual(
        RecoveryEngine.isIdempotentAction({type: 'click'}),
        false,
      );
    });
  });

  describe('ResultFormatter', () => {
    it('formats silent mode', () => {
      const out = ResultFormatter.formatResult(
        {ok: true, planId: 'p1', data: {x: 1}},
        'silent',
      );
      const parsed = JSON.parse(out) as Record<string, unknown>;
      assert.strictEqual(parsed['ok'], true);
      assert.strictEqual(parsed['planId'], 'p1');
      assert.strictEqual(parsed['data'], undefined);
    });

    it('formats compact mode by stripping heavy payloads', () => {
      const out = ResultFormatter.formatResult(
        {ok: true, domExcerpt: '<html>very long</html>', completedCount: 3},
        'compact',
      );
      const parsed = JSON.parse(out) as Record<string, unknown>;
      assert.strictEqual(parsed['ok'], true);
      assert.strictEqual(parsed['completedCount'], 3);
      assert.strictEqual(parsed['domExcerpt'], undefined);
    });
  });

  describe('hyper_act', () => {
    it('executes actions and returns formatted result', async () => {
      const {page, context, response, args} = createHandlerMocks();
      page.pptrPage.goto.resolves();

      await hyperAct(args).handler(
        {
          params: {
            actions: [
              {type: 'navigate', url: 'https://example.com'},
              {type: 'extract'},
            ],
          },
          page,
        },
        response,
        context,
      );

      sinon.assert.calledOnce(response.appendResponseLine);
      const arg = response.appendResponseLine.firstCall.args[0];
      const parsed = JSON.parse(arg) as Record<string, unknown>;
      assert.strictEqual(parsed['ok'], true);
      assert.strictEqual(parsed['actionsExecuted'], 2);
    });

    it('returns observation when observeAfter is true', async () => {
      const {page, context, response, args} = createHandlerMocks();
      page.pptrPage.goto.resolves();
      page.pptrPage.url.returns('https://example.com/next');
      page.pptrPage.title.resolves('Next Page');
      page.pptrPage.evaluate.resolves([
        {
          ref: '@0',
          tag: 'button',
          text: 'Next',
          selector: '#next-btn',
        },
      ]);

      await hyperAct(args).handler(
        {
          params: {
            actions: [{type: 'navigate', url: 'https://example.com/next'}],
            observeAfter: true,
          },
          page,
        },
        response,
        context,
      );

      sinon.assert.calledOnce(response.appendResponseLine);
      const arg = response.appendResponseLine.firstCall.args[0];
      const parsed = JSON.parse(arg) as Record<string, unknown>;
      assert.strictEqual(parsed['ok'], true);
      assert.strictEqual(parsed['page'], 'Next Page');
      assert.strictEqual(parsed['url'], 'https://example.com/next');
      const elements = parsed['elements'] as Array<Record<string, unknown>>;
      assert.strictEqual(elements.length, 1);
      assert.strictEqual(elements[0]?.['ref'], '@0');
    });

    it('executes actions with action-complete wait policy without delay', async () => {
      const {page} = createHandlerMocks();
      const results = await FastActionExecutor.executeBatch(
        {page, variables: {}},
        [
          {type: 'extract', waitPolicy: 'action-complete'},
          {type: 'capture', as: 'cap', waitPolicy: 'action-complete'},
        ],
      );
      assert.strictEqual(results.length, 2);
      assert.strictEqual(results[0]?.success, true);
      assert.strictEqual(results[1]?.success, true);
    });

    it('executes synthetic in-page DOM fast path for clicks and fills', async () => {
      const {page} = createHandlerMocks();
      page.pptrPage.evaluate.resolves([{success: true}]);

      const res = await FastActionExecutor.executeAction(
        {page, variables: {}},
        {type: 'fill', target: {selector: '#search'}, value: 'query'},
      );
      assert.strictEqual(res.success, true);
      sinon.assert.calledOnce(page.pptrPage.evaluate);
    });

    it('executes multi-action in-page DOM fusion batch in single evaluate', async () => {
      const {page} = createHandlerMocks();
      page.pptrPage.evaluate.resolves([{success: true}, {success: true}]);

      const results = await FastActionExecutor.executeBatch(
        {page, variables: {}},
        [
          {type: 'fill', target: {selector: '#name'}, value: 'Alice'},
          {type: 'click', target: {selector: '#submit'}},
        ],
      );
      assert.strictEqual(results.length, 2);
      assert.strictEqual(results[0]?.success, true);
      assert.strictEqual(results[1]?.success, true);
      sinon.assert.calledOnce(page.pptrPage.evaluate);
    });

    it('formats monotonic latency instrumentation correctly', () => {
      const tracker = new LatencyTracker('plan-1', 'step-1', 'click');
      tracker.markQueue(10, 12);
      tracker.markResolve(12, 15);
      tracker.markAction(15, 25);
      const formatted = tracker.format();
      assert.ok(formatted.includes('[HYPER PERF]'));
      assert.ok(formatted.includes('queue=2ms'));
      assert.ok(formatted.includes('resolve=3ms'));
      assert.ok(formatted.includes('action=10ms'));
    });

    it('accepts string targets coerced to {css: str}', () => {
      const parsed = locatorSchema.parse('#search');
      assert.strictEqual(parsed.css, '#search');
    });
  });

  describe('fast mode profile filtering', () => {
    it('recognizes fast tools', () => {
      assert.strictEqual(isFastTool({name: 'hyper_act'}), true);
      assert.strictEqual(isFastTool({name: 'hyper_execute_plan'}), true);
      assert.strictEqual(isFastTool({name: 'hyper_observe'}), true);
      assert.strictEqual(isFastTool({name: 'click'}), false);
      assert.strictEqual(isFastTool({name: 'fill'}), false);
    });

    it('filters tools correctly when fast mode is enabled', () => {
      const hyperTool = {
        name: 'hyper_act',
        annotations: {category: ToolCategory.INPUT, readOnlyHint: false},
      };
      const normalTool = {
        name: 'click',
        annotations: {category: ToolCategory.INPUT, readOnlyHint: false},
      };
      assert.strictEqual(
        isAvailableInMode(hyperTool, {slim: false, fast: true}),
        true,
      );
      assert.strictEqual(
        isAvailableInMode(normalTool, {slim: false, fast: true}),
        false,
      );
    });
  });

  describe('hyper_execute_plan', () => {
    it('executes dry-run plan without browser mutations', async () => {
      const {context, response, args} = createHandlerMocks();

      await hyperExecutePlan(args).handler(
        {
          params: {
            planId: 'demo-plan',
            dryRun: true,
            steps: [
              {id: 'step1', type: 'navigate', url: 'https://example.com'},
              {id: 'step2', type: 'extract', dependsOn: ['step1']},
            ],
          },
        },
        response,
        context,
      );

      sinon.assert.calledOnce(response.appendResponseLine);
      const arg = response.appendResponseLine.firstCall.args[0];
      const parsed = JSON.parse(arg) as Record<string, unknown>;
      assert.strictEqual(parsed['ok'], true);
      assert.strictEqual(parsed['completedSteps'], 2);
    });
  });

  describe('hyper_parallel', () => {
    it('runs independent tasks across pages', async () => {
      const {page, context, response, args} = createHandlerMocks();
      context.getPageById.returns(page);
      context.getSelectedMcpPage.returns(page);

      await hyperParallel(args).handler(
        {
          params: {
            tasks: [
              {id: 'task1', actions: [{type: 'extract'}]},
              {id: 'task2', actions: [{type: 'extract'}]},
            ],
          },
        },
        response,
        context,
      );

      sinon.assert.calledOnce(response.appendResponseLine);
      const arg = response.appendResponseLine.firstCall.args[0];
      const parsed = JSON.parse(arg) as Record<string, unknown>;
      assert.strictEqual(parsed['ok'], true);
      assert.strictEqual(parsed['totalTasks'], 2);
    });
  });

  describe('hyper_observe', () => {
    it('supports minimal observation mode', async () => {
      const {page, context, response, args} = createHandlerMocks();
      page.pptrPage.url.returns('https://example.com');
      page.pptrPage.title.resolves('Example Domain');

      await hyperObserve(args).handler(
        {
          params: {mode: 'minimal'},
          page,
        },
        response,
        context,
      );

      sinon.assert.calledOnce(response.appendResponseLine);
      const arg = response.appendResponseLine.firstCall.args[0];
      const parsed = JSON.parse(arg) as Record<string, unknown>;
      assert.strictEqual(parsed['ok'], true);
      assert.strictEqual(parsed['title'], 'Example Domain');
    });

    it('returns interactive elements with selectors in minimal mode', async () => {
      const {page, context, response, args} = createHandlerMocks();
      page.pptrPage.url.returns('https://example.com');
      page.pptrPage.title.resolves('Example Domain');
      page.pptrPage.evaluate.resolves([
        {
          tag: 'button',
          text: 'Submit',
          selector: '#submit-btn',
        },
      ]);

      await hyperObserve(args).handler(
        {
          params: {mode: 'minimal'},
          page,
        },
        response,
        context,
      );

      sinon.assert.calledOnce(response.appendResponseLine);
      const arg = response.appendResponseLine.firstCall.args[0];
      const parsed = JSON.parse(arg) as Record<string, unknown>;
      assert.strictEqual(parsed['ok'], true);
      const elements = parsed['elements'] as Array<Record<string, unknown>>;
      assert.strictEqual(elements.length, 1);
      assert.strictEqual(elements[0]?.['selector'], '#submit-btn');
    });
  });

  describe('hyper_wait_for', () => {
    it('waits for elementVisible condition', async () => {
      const {page, context, response, args} = createHandlerMocks();
      page.pptrPage.waitForSelector.resolves();

      await hyperWaitFor(args).handler(
        {
          params: {
            condition: JSON.stringify({
              kind: 'elementVisible',
              target: {css: '.target'},
            }),
          },
          page,
        },
        response,
        context,
      );

      sinon.assert.calledOnce(response.appendResponseLine);
      const arg = response.appendResponseLine.firstCall.args[0];
      const parsed = JSON.parse(arg) as Record<string, unknown>;
      assert.strictEqual(parsed['ok'], true);
      assert.strictEqual(parsed['kind'], 'elementVisible');
    });
  });

  describe('hyper_bulk_extract', () => {
    it('extracts batch items using $$eval', async () => {
      const {page, context, response, args} = createHandlerMocks();
      page.pptrPage.$$eval.resolves([{text: 'Item 1'}, {text: 'Item 2'}]);

      await hyperBulkExtract(args).handler(
        {
          params: {
            itemSelector: '.item',
            maxItems: 10,
          },
          page,
        },
        response,
        context,
      );

      sinon.assert.calledOnce(response.appendResponseLine);
      const arg = response.appendResponseLine.firstCall.args[0];
      const parsed = JSON.parse(arg) as Record<string, unknown>;
      assert.strictEqual(parsed['ok'], true);
      assert.strictEqual(parsed['totalExtracted'], 2);
    });
  });

  describe('hyper_recover', () => {
    it('recovers by reloading page', async () => {
      const {page, context, response, args} = createHandlerMocks();
      page.pptrPage.reload.resolves();

      await hyperRecover(args).handler(
        {
          params: {actionType: 'reload'},
          page,
        },
        response,
        context,
      );

      sinon.assert.calledOnce(response.appendResponseLine);
      const arg = response.appendResponseLine.firstCall.args[0];
      const parsed = JSON.parse(arg) as Record<string, unknown>;
      assert.strictEqual(parsed['ok'], true);
      assert.strictEqual(parsed['action'], 'reload');
    });
  });

  describe('hyper_network_watch', () => {
    it('returns network watch records', async () => {
      const {page, context, response, args} = createHandlerMocks();
      await hyperNetworkWatch(args).handler(
        {params: {}, page},
        response,
        context,
      );
      sinon.assert.calledOnce(response.appendResponseLine);
      const arg = response.appendResponseLine.firstCall.args[0];
      const parsed = JSON.parse(arg) as Record<string, unknown>;
      assert.strictEqual(parsed['ok'], true);
    });
  });

  describe('hyper_console_watch', () => {
    it('returns console watch messages', async () => {
      const {page, context, response, args} = createHandlerMocks();
      await hyperConsoleWatch(args).handler(
        {params: {}, page},
        response,
        context,
      );
      sinon.assert.calledOnce(response.appendResponseLine);
      const arg = response.appendResponseLine.firstCall.args[0];
      const parsed = JSON.parse(arg) as Record<string, unknown>;
      assert.strictEqual(parsed['ok'], true);
    });
  });

  describe('hyper_debug_capture', () => {
    it('captures consolidated diagnostics', async () => {
      const {page, context, response, args} = createHandlerMocks();
      page.pptrPage.evaluate.resolves('<div>content</div>');
      page.pptrPage.url.returns('https://example.com');
      page.pptrPage.title.resolves('Title');

      await hyperDebugCapture(args).handler(
        {params: {}, page},
        response,
        context,
      );
      sinon.assert.calledOnce(response.appendResponseLine);
      const arg = response.appendResponseLine.firstCall.args[0];
      const parsed = JSON.parse(arg) as Record<string, unknown>;
      assert.strictEqual(parsed['ok'], true);
    });
  });

  describe('hyper_download_manager', () => {
    it('configures download behavior', async () => {
      const {page, context, response, args} = createHandlerMocks();
      page.pptrPage.createCDPSession.resolves(createMockCDPSession());

      await hyperDownloadManager(args).handler(
        {
          params: {action: 'configure', downloadPath: './downloads'},
          page,
        },
        response,
        context,
      );
      sinon.assert.calledOnce(response.appendResponseLine);
      const arg = response.appendResponseLine.firstCall.args[0];
      const parsed = JSON.parse(arg) as Record<string, unknown>;
      assert.strictEqual(parsed['ok'], true);
    });
  });

  describe('hyper_session_status', () => {
    it('returns session connection status', async () => {
      const {context, response, args} = createHandlerMocks();

      await hyperSessionStatus(args).handler(
        {
          params: {},
        },
        response,
        context,
      );

      sinon.assert.calledOnce(response.appendResponseLine);
      const arg = response.appendResponseLine.firstCall.args[0];
      const parsed = JSON.parse(arg) as Record<string, unknown>;
      assert.strictEqual(parsed['ok'], true);
    });
  });
});
