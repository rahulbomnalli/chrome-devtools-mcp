/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {HyperErrorCode, type WorkflowStep} from './types.js';

export class PlanValidationError extends Error {
  readonly code: HyperErrorCode = HyperErrorCode.VALIDATION_ERROR;

  constructor(message: string) {
    super(message);
    this.name = 'PlanValidationError';
  }
}

export interface CompiledStage {
  stageIndex: number;
  steps: WorkflowStep[];
}

export interface CompiledPlan {
  planId: string;
  version: string;
  stages: CompiledStage[];
  stepMap: Map<string, WorkflowStep>;
  initialVariables: Record<string, string>;
  maxConcurrency: number;
  timeoutMs: number;
  dryRun: boolean;
}

export class PlanCompiler {
  static validateAndCompile(plan: {
    planId: string;
    version?: string;
    steps: WorkflowStep[];
    variables?: Record<string, string>;
    timeoutMs?: number;
    maxConcurrency?: number;
    dryRun?: boolean;
  }): CompiledPlan {
    if (!plan.steps || plan.steps.length === 0) {
      throw new PlanValidationError('Workflow plan contains no steps');
    }

    const stepMap = new Map<string, WorkflowStep>();
    const inDegree = new Map<string, number>();
    const adjacency = new Map<string, string[]>();

    // Step 1: Check uniqueness of IDs
    for (const step of plan.steps) {
      if (stepMap.has(step.id)) {
        throw new PlanValidationError(
          `Duplicate step id "${step.id}" in plan "${plan.planId}"`,
        );
      }
      stepMap.set(step.id, step);
      inDegree.set(step.id, 0);
      adjacency.set(step.id, []);
    }

    // Step 2: Validate dependencies and build graph
    for (const step of plan.steps) {
      const deps = step.dependsOn ?? [];
      for (const depId of deps) {
        if (!stepMap.has(depId)) {
          throw new PlanValidationError(
            `Step "${step.id}" depends on unknown step "${depId}"`,
          );
        }
        const adj = adjacency.get(depId);
        if (adj) {
          adj.push(step.id);
        }
        const currentDegree = inDegree.get(step.id) ?? 0;
        inDegree.set(step.id, currentDegree + 1);
      }
    }

    // Step 3: Kahn's topological sort into concurrent stages
    const stages: CompiledStage[] = [];
    let processedCount = 0;
    let currentZeroDegree: string[] = [];

    for (const [id, deg] of inDegree.entries()) {
      if (deg === 0) {
        currentZeroDegree.push(id);
      }
    }

    let stageIdx = 0;
    while (currentZeroDegree.length > 0) {
      const stageSteps: WorkflowStep[] = [];
      const nextZeroDegree: string[] = [];

      for (const stepId of currentZeroDegree) {
        const step = stepMap.get(stepId);
        if (step) {
          stageSteps.push(step);
          processedCount++;
        }

        const neighbors = adjacency.get(stepId) ?? [];
        for (const neighborId of neighbors) {
          const currentDeg = inDegree.get(neighborId) ?? 1;
          const nextDeg = currentDeg - 1;
          inDegree.set(neighborId, nextDeg);
          if (nextDeg === 0) {
            nextZeroDegree.push(neighborId);
          }
        }
      }

      stages.push({
        stageIndex: stageIdx++,
        steps: stageSteps,
      });

      currentZeroDegree = nextZeroDegree;
    }

    if (processedCount < plan.steps.length) {
      throw new PlanValidationError(
        `Dependency cycle detected in workflow plan "${plan.planId}". Only ${processedCount} of ${plan.steps.length} steps can be ordered.`,
      );
    }

    return {
      planId: plan.planId,
      version: plan.version ?? '1',
      stages,
      stepMap,
      initialVariables: plan.variables ?? {},
      maxConcurrency: plan.maxConcurrency ?? 3,
      timeoutMs: plan.timeoutMs ?? 60000,
      dryRun: Boolean(plan.dryRun),
    };
  }
}
