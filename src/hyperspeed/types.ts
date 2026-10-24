/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {zod} from '../third_party/index.js';

export enum HyperErrorCode {
  VALIDATION_ERROR = 'VALIDATION_ERROR',
  LOCATOR_NOT_FOUND = 'LOCATOR_NOT_FOUND',
  AMBIGUOUS_TARGET = 'AMBIGUOUS_TARGET',
  STALE_ELEMENT = 'STALE_ELEMENT',
  NAVIGATION_ERROR = 'NAVIGATION_ERROR',
  TIMEOUT = 'TIMEOUT',
  CONNECTION_LOST = 'CONNECTION_LOST',
  TARGET_CLOSED = 'TARGET_CLOSED',
  PERMISSION_DENIED = 'PERMISSION_DENIED',
  ASSERTION_FAILED = 'ASSERTION_FAILED',
  CANCELLED = 'CANCELLED',
  UNKNOWN = 'UNKNOWN',
}

export type OutputMode = 'silent' | 'compact' | 'normal' | 'debug' | 'full';

export const outputModeSchema: zod.ZodType<OutputMode> = zod
  .enum(['silent', 'compact', 'normal', 'debug', 'full'])
  .default('compact');

export interface LocatorTarget {
  uid?: string;
  role?: string;
  name?: string;
  label?: string;
  placeholder?: string;
  text?: string;
  css?: string;
  selector?: string;
  xpath?: string;
  x?: number;
  y?: number;
}

export const locatorSchema: zod.ZodType<LocatorTarget> = zod.union([
  zod.string().transform(str => ({css: str})),
  zod.object({
    uid: zod.string().optional(),
    role: zod.string().optional(),
    name: zod.string().optional(),
    label: zod.string().optional(),
    placeholder: zod.string().optional(),
    text: zod.string().optional(),
    css: zod.string().optional(),
    selector: zod.string().optional(),
    xpath: zod.string().optional(),
    x: zod.number().optional(),
    y: zod.number().optional(),
  }),
]);

export type ActionType =
  | 'navigate'
  | 'click'
  | 'dblclick'
  | 'fill'
  | 'type'
  | 'press_key'
  | 'hover'
  | 'scroll'
  | 'select'
  | 'check'
  | 'uncheck'
  | 'upload'
  | 'drag'
  | 'wait'
  | 'extract'
  | 'evaluate'
  | 'assert'
  | 'capture';

export const actionTypeSchema: zod.ZodType<ActionType> = zod.enum([
  'navigate',
  'click',
  'dblclick',
  'fill',
  'type',
  'press_key',
  'hover',
  'scroll',
  'select',
  'check',
  'uncheck',
  'upload',
  'drag',
  'wait',
  'extract',
  'evaluate',
  'assert',
  'capture',
]);

export type WaitPolicy =
  | 'action-complete'
  | 'navigation'
  | 'element-visible'
  | 'element-hidden'
  | 'url-match'
  | 'network-response'
  | 'dom-stable'
  | 'custom-condition';

export const waitPolicySchema: zod.ZodType<WaitPolicy> = zod.enum([
  'action-complete',
  'navigation',
  'element-visible',
  'element-hidden',
  'url-match',
  'network-response',
  'dom-stable',
  'custom-condition',
]);

export interface WaitCondition {
  kind:
    | 'elementVisible'
    | 'elementHidden'
    | 'elementAttached'
    | 'elementDetached'
    | 'textChanged'
    | 'urlMatched'
    | 'navigationCommitted'
    | 'networkResponse'
    | 'downloadCompleted'
    | 'jsPredicate'
    | 'dialogAppeared';
  target?: LocatorTarget;
  text?: string;
  urlPattern?: string;
  predicate?: string;
  timeoutMs?: number;
}

export const waitConditionSchema: zod.ZodType<WaitCondition> = zod.object({
  kind: zod.enum([
    'elementVisible',
    'elementHidden',
    'elementAttached',
    'elementDetached',
    'textChanged',
    'urlMatched',
    'navigationCommitted',
    'networkResponse',
    'downloadCompleted',
    'jsPredicate',
    'dialogAppeared',
  ]),
  target: locatorSchema.optional(),
  text: zod.string().optional(),
  urlPattern: zod.string().optional(),
  predicate: zod.string().optional(),
  timeoutMs: zod.number().optional(),
});

export interface AssertCondition {
  kind:
    | 'exists'
    | 'notExists'
    | 'visible'
    | 'hidden'
    | 'equals'
    | 'contains'
    | 'nonEmpty'
    | 'matches';
  target?: LocatorTarget;
  valueRef?: string;
  expected?: string;
  attribute?: string;
}

export const assertConditionSchema: zod.ZodType<AssertCondition> = zod.object({
  kind: zod.enum([
    'exists',
    'notExists',
    'visible',
    'hidden',
    'equals',
    'contains',
    'nonEmpty',
    'matches',
  ]),
  target: locatorSchema.optional(),
  valueRef: zod.string().optional(),
  expected: zod.string().optional(),
  attribute: zod.string().optional(),
});

export interface ActionItem {
  id?: string;
  type: ActionType;
  target?: LocatorTarget;
  url?: string;
  value?: string;
  key?: string;
  files?: string[];
  scrollDeltaX?: number;
  scrollDeltaY?: number;
  dragTo?: LocatorTarget;
  script?: string;
  condition?: WaitCondition;
  assertion?: AssertCondition;
  as?: string;
  attribute?: string;
  timeoutMs?: number;
  continueOnError?: boolean;
  waitPolicy?: WaitPolicy;
  waitUrl?: string;
  synthetic?: boolean;
}

export const actionItemSchema: zod.ZodType<ActionItem> = zod.object({
  id: zod.string().optional(),
  type: actionTypeSchema,
  target: locatorSchema.optional(),
  url: zod.string().optional(),
  value: zod.string().optional(),
  key: zod.string().optional(),
  files: zod.array(zod.string()).optional(),
  scrollDeltaX: zod.number().optional(),
  scrollDeltaY: zod.number().optional(),
  dragTo: locatorSchema.optional(),
  script: zod.string().optional(),
  condition: waitConditionSchema.optional(),
  assertion: assertConditionSchema.optional(),
  as: zod.string().optional(),
  attribute: zod.string().optional(),
  timeoutMs: zod.number().optional(),
  continueOnError: zod.boolean().optional(),
  waitPolicy: waitPolicySchema.optional(),
  waitUrl: zod.string().optional(),
  synthetic: zod.boolean().optional(),
});

export interface WorkflowStep extends ActionItem {
  id: string;
  pageId?: number;
  dependsOn?: string[];
  ifCondition?: {
    variable: string;
    operator: 'equals' | 'notEquals' | 'contains' | 'truthy' | 'falsy';
    value?: string;
  };
  retryCount?: number;
}

export const workflowStepSchema: zod.ZodType<WorkflowStep> = zod.object({
  id: zod.string(),
  type: actionTypeSchema,
  target: locatorSchema.optional(),
  url: zod.string().optional(),
  value: zod.string().optional(),
  key: zod.string().optional(),
  files: zod.array(zod.string()).optional(),
  scrollDeltaX: zod.number().optional(),
  scrollDeltaY: zod.number().optional(),
  dragTo: locatorSchema.optional(),
  script: zod.string().optional(),
  condition: waitConditionSchema.optional(),
  assertion: assertConditionSchema.optional(),
  as: zod.string().optional(),
  attribute: zod.string().optional(),
  timeoutMs: zod.number().optional(),
  continueOnError: zod.boolean().optional(),
  waitPolicy: waitPolicySchema.optional(),
  waitUrl: zod.string().optional(),
  pageId: zod.number().optional(),
  dependsOn: zod.array(zod.string()).optional(),
  ifCondition: zod
    .object({
      variable: zod.string(),
      operator: zod.enum([
        'equals',
        'notEquals',
        'contains',
        'truthy',
        'falsy',
      ]),
      value: zod.string().optional(),
    })
    .optional(),
  retryCount: zod.number().optional(),
});

export interface StepExecutionResult {
  stepId: string;
  type: string;
  pageId?: number;
  durationMs: number;
  success: boolean;
  error?: string;
  errorCode?: HyperErrorCode;
  extractedData?: unknown;
}

export interface PlanExecutionSummary {
  ok: boolean;
  planId: string;
  durationMs: number;
  completedSteps: number;
  failedSteps: number;
  skippedSteps: number;
  data: Record<string, unknown>;
  errors?: Array<{
    stepId: string;
    error: string;
    code: HyperErrorCode;
  }>;
  stepTimings?: Record<string, number>;
}

export interface ParallelTaskInput {
  id: string;
  pageId?: number;
  actions: ActionItem[];
}

export const parallelTaskSchema: zod.ZodType<ParallelTaskInput> = zod.object({
  id: zod.string(),
  pageId: zod.number().optional(),
  actions: zod.array(actionItemSchema),
});

export interface NetworkInterceptRuleInput {
  urlPattern: string;
  action: 'block' | 'mock' | 'modifyHeaders';
  mockStatus?: number;
  mockBody?: string;
  mockContentType?: string;
  addHeaders?: Record<string, string>;
}

export const networkInterceptRuleSchema: zod.ZodType<NetworkInterceptRuleInput> =
  zod.object({
    urlPattern: zod.string(),
    action: zod.enum(['block', 'mock', 'modifyHeaders']),
    mockStatus: zod.number().optional(),
    mockBody: zod.string().optional(),
    mockContentType: zod.string().optional(),
    addHeaders: zod.record(zod.string(), zod.string()).optional(),
  });
