/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type {Context, ContextPage} from '../tools/ToolDefinition.js';
import {ActionExecutor} from './ActionExecutor.js';
import {type CompiledPlan} from './PlanCompiler.js';
import {
  HyperErrorCode,
  type PlanExecutionSummary,
  type StepExecutionResult,
  type WorkflowStep,
} from './types.js';

export class PlanExecutor {
  static async execute(
    context: Context,
    plan: CompiledPlan,
  ): Promise<PlanExecutionSummary> {
    const startTime = Date.now();
    const variables: Record<string, unknown> = {...plan.initialVariables};
    const stepResults: StepExecutionResult[] = [];
    const errors: Array<{
      stepId: string;
      error: string;
      code: HyperErrorCode;
    }> = [];
    const stepTimings: Record<string, number> = {};

    let completedSteps = 0;
    let failedSteps = 0;
    let skippedSteps = 0;

    if (plan.dryRun) {
      for (const stage of plan.stages) {
        for (const step of stage.steps) {
          completedSteps++;
          stepTimings[step.id] = 0;
          stepResults.push({
            stepId: step.id,
            type: step.type,
            pageId: step.pageId,
            durationMs: 0,
            success: true,
            extractedData: '(dry-run simulated)',
          });
        }
      }

      return {
        ok: true,
        planId: plan.planId,
        durationMs: Date.now() - startTime,
        completedSteps,
        failedSteps: 0,
        skippedSteps: 0,
        data: variables,
        stepTimings,
      };
    }

    for (const stage of plan.stages) {
      if (Date.now() - startTime > plan.timeoutMs) {
        errors.push({
          stepId: 'workflow',
          error: `Plan exceeded workflow deadline of ${plan.timeoutMs}ms`,
          code: HyperErrorCode.TIMEOUT,
        });
        break;
      }

      const stepsByPage = new Map<number | undefined, WorkflowStep[]>();
      for (const step of stage.steps) {
        const list = stepsByPage.get(step.pageId) ?? [];
        list.push(step);
        stepsByPage.set(step.pageId, list);
      }

      const pageGroups = Array.from(stepsByPage.entries());
      const stageTasks = pageGroups.map(async ([stagePageId, steps]) => {
        let page: ContextPage | undefined;
        if (stagePageId !== undefined) {
          page = context.getPageById(stagePageId);
        } else {
          page = context.getSelectedMcpPage();
        }

        if (page) {
          await page.init({emulateFocus: true});
        }

        for (const step of steps) {
          if (step.ifCondition) {
            const varVal = String(variables[step.ifCondition.variable] ?? '');
            let condMet = false;
            switch (step.ifCondition.operator) {
              case 'equals':
                condMet = varVal === step.ifCondition.value;
                break;
              case 'notEquals':
                condMet = varVal !== step.ifCondition.value;
                break;
              case 'contains':
                condMet = varVal.includes(step.ifCondition.value ?? '');
                break;
              case 'truthy':
                condMet = Boolean(varVal) && varVal !== 'false';
                break;
              case 'falsy':
                condMet = !varVal || varVal === 'false';
                break;
            }

            if (!condMet) {
              skippedSteps++;
              stepResults.push({
                stepId: step.id,
                type: step.type,
                pageId: step.pageId,
                durationMs: 0,
                success: true,
                extractedData: '(skipped)',
              });
              continue;
            }
          }

          let currentStepPage = page;
          if (step.pageId !== undefined && step.pageId !== stagePageId) {
            currentStepPage = context.getPageById(step.pageId);
            if (currentStepPage) {
              await currentStepPage.init({emulateFocus: true});
            }
          }

          if (!currentStepPage) {
            failedSteps++;
            const errCode = HyperErrorCode.TARGET_CLOSED;
            errors.push({
              stepId: step.id,
              error: `Target page ${step.pageId ?? 'selected'} not found`,
              code: errCode,
            });
            if (!step.continueOnError) {
              return false;
            }
            continue;
          }

          const actionRes = await ActionExecutor.executeAction(
            currentStepPage,
            step,
            variables,
          );

          stepTimings[step.id] = actionRes.durationMs;

          if (actionRes.success) {
            completedSteps++;
            stepResults.push({
              stepId: step.id,
              type: step.type,
              pageId: step.pageId,
              durationMs: actionRes.durationMs,
              success: true,
              extractedData: actionRes.extracted,
            });
          } else {
            failedSteps++;
            const errCode = actionRes.errorCode ?? HyperErrorCode.UNKNOWN;
            errors.push({
              stepId: step.id,
              error: actionRes.error ?? 'Unknown error in step',
              code: errCode,
            });
            stepResults.push({
              stepId: step.id,
              type: step.type,
              pageId: step.pageId,
              durationMs: actionRes.durationMs,
              success: false,
              error: actionRes.error,
              errorCode: errCode,
            });

            if (!step.continueOnError) {
              return false;
            }
          }
        }
        return true;
      });

      const results = await Promise.all(stageTasks);
      if (results.some(success => !success)) {
        break;
      }
    }

    const durationMs = Date.now() - startTime;
    const ok = failedSteps === 0 && errors.length === 0;

    return {
      ok,
      planId: plan.planId,
      durationMs,
      completedSteps,
      failedSteps,
      skippedSteps,
      data: variables,
      errors: errors.length > 0 ? errors : undefined,
      stepTimings,
    };
  }
}
