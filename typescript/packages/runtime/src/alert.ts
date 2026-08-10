import {
  OPENPLAIT_API_VERSION,
  validateAlertRule,
  type AlertLifecycleState,
  type AlertNotificationEvent,
  type AlertRule,
  type ParameterMap,
  type Query,
  type QueryResult,
} from "@openplait/core";
import type { AuditContext } from "@openplait/adapter-sdk";

import { RuntimeError } from "./errors.js";
import type { OpenPlaitRuntime } from "./runtime.js";
import type { RuntimeExecutionMetadata, RuntimeExecutionResponse } from "./types.js";

export interface AlertStateRecord {
  rule: string;
  state: AlertLifecycleState;
  changedAt: string;
  evaluatedAt: string;
  activeSince?: string;
  conditionMet: boolean;
  value?: number;
  reason?: string;
}

export interface AlertStateStore {
  get(rule: string): Promise<AlertStateRecord | undefined>;
  set(rule: string, state: AlertStateRecord): Promise<void>;
}

export interface AlertNotificationIntent {
  channelRef: string;
  event: AlertNotificationEvent;
  rule: string;
  state: AlertLifecycleState;
  previousState?: AlertLifecycleState;
  value?: number;
  labels: Record<string, string>;
  annotations: Record<string, string>;
}

export interface AlertEvaluationContext {
  audit: AuditContext;
  variables?: ParameterMap;
  abortSignal?: AbortSignal;
  timeoutMs?: number;
  now?: Date;
  suppressed?: boolean;
}

export interface AlertEvaluationResult {
  rule: string;
  state: AlertLifecycleState;
  previousState?: AlertLifecycleState;
  changed: boolean;
  evaluatedAt: string;
  activeSince?: string;
  conditionMet: boolean;
  value?: number;
  reason?: string;
  notifications: AlertNotificationIntent[];
  result?: QueryResult;
  runtimeMetadata?: RuntimeExecutionMetadata;
}

export interface AlertEvaluatorOptions {
  stateStore?: AlertStateStore;
  now?: () => Date;
}

export class InMemoryAlertStateStore implements AlertStateStore {
  private readonly states = new Map<string, AlertStateRecord>();

  async get(rule: string): Promise<AlertStateRecord | undefined> {
    const value = this.states.get(rule);
    return value ? structuredClone(value) : undefined;
  }

  async set(rule: string, state: AlertStateRecord): Promise<void> {
    this.states.set(rule, structuredClone(state));
  }
}

export function durationToMilliseconds(duration: string): number {
  const match = /^(\d+)(ms|s|m|h|d|w)$/.exec(duration);
  if (!match) throw new RuntimeError("ALERT_RULE_INVALID", `Duration '${duration}' is invalid.`);
  const value = Number(match[1]);
  const unit = match[2]!;
  const factors: Record<string, number> = {
    ms: 1,
    s: 1_000,
    m: 60_000,
    h: 3_600_000,
    d: 86_400_000,
    w: 604_800_000,
  };
  return value * factors[unit]!;
}

export function nextAlertEvaluationAt(rule: AlertRule, from: Date): Date {
  return new Date(from.getTime() + durationToMilliseconds(rule.spec.evaluation.every));
}

function reduceAlertValue(result: QueryResult, field: string, reducer: string): number | undefined {
  const values = result.frames.flatMap((frame) =>
    frame.fields
      .filter((candidate) => candidate.name === field)
      .flatMap((candidate) => candidate.values)
      .filter((value): value is number => typeof value === "number" && Number.isFinite(value)),
  );
  if (values.length === 0) return undefined;
  if (reducer === "first") return values[0];
  if (reducer === "last") return values.at(-1);
  if (reducer === "min") return Math.min(...values);
  if (reducer === "max") return Math.max(...values);
  if (reducer === "sum") return values.reduce((sum, value) => sum + value, 0);
  if (reducer === "count") return values.length;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function conditionMatches(value: number, operator: string, threshold: number): boolean {
  if (operator === "equals") return value === threshold;
  if (operator === "notEquals") return value !== threshold;
  if (operator === "greaterThan") return value > threshold;
  if (operator === "greaterThanOrEqual") return value >= threshold;
  if (operator === "lessThan") return value < threshold;
  return value <= threshold;
}

function notificationEvent(
  state: AlertLifecycleState,
  previous: AlertLifecycleState | undefined,
): AlertNotificationEvent | undefined {
  if (state === "firing" && previous !== "firing") return "firing";
  if (state === "normal" && previous === "firing") return "resolved";
  if (state === "error" && previous !== "error") return "error";
  if (state === "no_data" && previous !== "no_data") return "no_data";
  return undefined;
}

function notificationIntents(
  rule: AlertRule,
  state: AlertLifecycleState,
  previous: AlertLifecycleState | undefined,
  value: number | undefined,
): AlertNotificationIntent[] {
  if (state === "suppressed") return [];
  const event = notificationEvent(state, previous);
  if (!event) return [];
  return (rule.spec.notifications ?? [])
    .filter(({ notifyOn }) => (notifyOn ?? ["firing", "resolved"]).includes(event))
    .map(({ channelRef }) => ({
      channelRef,
      event,
      rule: rule.metadata.name,
      state,
      ...(previous === undefined ? {} : { previousState: previous }),
      ...(value === undefined ? {} : { value }),
      labels: structuredClone(rule.spec.labels ?? {}),
      annotations: structuredClone(rule.spec.annotations ?? {}),
    }));
}

function queryFor(rule: AlertRule): Query {
  return {
    apiVersion: OPENPLAIT_API_VERSION,
    kind: "Query",
    metadata: { name: `${rule.metadata.name}-evaluation` },
    spec: structuredClone(rule.spec.query.spec),
  };
}

function stateRecord(
  rule: AlertRule,
  previous: AlertStateRecord | undefined,
  now: Date,
  desired: AlertLifecycleState,
  conditionMet: boolean,
  value: number | undefined,
  activeSince: string | undefined,
  reason: string | undefined,
): AlertStateRecord {
  const evaluatedAt = now.toISOString();
  return {
    rule: rule.metadata.name,
    state: desired,
    changedAt: previous?.state === desired ? previous.changedAt : evaluatedAt,
    evaluatedAt,
    ...(activeSince === undefined ? {} : { activeSince }),
    conditionMet,
    ...(value === undefined ? {} : { value }),
    ...(reason === undefined ? {} : { reason }),
  };
}

export class AlertEvaluator {
  private readonly stateStore: AlertStateStore;
  private readonly now: () => Date;
  private readonly locks = new Map<string, Promise<unknown>>();

  constructor(
    private readonly runtime: Pick<OpenPlaitRuntime, "execute">,
    options: AlertEvaluatorOptions = {},
  ) {
    this.stateStore = options.stateStore ?? new InMemoryAlertStateStore();
    this.now = options.now ?? (() => new Date());
  }

  evaluate(rule: AlertRule, context: AlertEvaluationContext): Promise<AlertEvaluationResult> {
    const previousRun = this.locks.get(rule.metadata.name) ?? Promise.resolve();
    const current = previousRun.catch(() => undefined).then(() => this.evaluateLocked(rule, context));
    this.locks.set(rule.metadata.name, current);
    void current.finally(() => {
      if (this.locks.get(rule.metadata.name) === current) this.locks.delete(rule.metadata.name);
    }).catch(() => undefined);
    return current;
  }

  private async evaluateLocked(
    rule: AlertRule,
    context: AlertEvaluationContext,
  ): Promise<AlertEvaluationResult> {
    const validation = validateAlertRule(rule);
    if (!validation.valid) {
      throw new RuntimeError("ALERT_RULE_INVALID", `Alert rule '${rule.metadata.name}' is invalid.`, {
        details: { errors: validation.errors },
      });
    }
    const source = validation.value;
    const now = context.now ?? this.now();
    const previous = await this.stateStore.get(source.metadata.name);
    if (source.spec.enabled === false || context.suppressed) {
      const disabled = source.spec.enabled === false;
      const record = stateRecord(
        source,
        previous,
        now,
        "suppressed",
        disabled ? false : (previous?.conditionMet ?? false),
        disabled ? undefined : previous?.value,
        disabled ? undefined : previous?.activeSince,
        disabled ? "disabled" : "suppressed",
      );
      await this.stateStore.set(source.metadata.name, record);
      return this.resultFrom(source, previous, record, []);
    }

    let response: RuntimeExecutionResponse;
    try {
      const lookback = durationToMilliseconds(
        source.spec.evaluation.lookback ?? source.spec.evaluation.every,
      );
      const variables: ParameterMap = {
        __from: new Date(now.getTime() - lookback).toISOString(),
        __to: now.toISOString(),
        ...(context.variables ?? {}),
      };
      response = await this.runtime.execute({
        queries: [queryFor(source)],
        transformations: source.spec.transformations ?? [],
        variables,
        audit: context.audit,
        ...(context.abortSignal === undefined ? {} : { abortSignal: context.abortSignal }),
        ...(context.timeoutMs === undefined ? {} : { timeoutMs: context.timeoutMs }),
      });
      if (response.deferredTransformations.length > 0) {
        throw new RuntimeError("ALERT_RULE_INVALID", "Alert transformations cannot be client-deferred.");
      }
    } catch (error) {
      if (error instanceof RuntimeError && error.code === "CANCELLED") throw error;
      const desired = source.spec.evaluation.errorState ?? "error";
      const record = stateRecord(
        source,
        previous,
        now,
        desired,
        desired === "firing",
        undefined,
        desired === "firing" ? now.toISOString() : undefined,
        error instanceof Error ? error.message : String(error),
      );
      await this.stateStore.set(source.metadata.name, record);
      return this.resultFrom(source, previous, record, notificationIntents(source, desired, previous?.state, undefined));
    }

    const value = reduceAlertValue(
      response.result,
      source.spec.condition.field,
      source.spec.condition.reducer ?? "last",
    );
    if (value === undefined) {
      const desired = source.spec.evaluation.noDataState ?? "no_data";
      const record = stateRecord(
        source,
        previous,
        now,
        desired,
        desired === "firing",
        undefined,
        desired === "firing" ? now.toISOString() : undefined,
        "No numeric values were returned for the alert field.",
      );
      await this.stateStore.set(source.metadata.name, record);
      return this.resultFrom(
        source,
        previous,
        record,
        notificationIntents(source, desired, previous?.state, undefined),
        response,
      );
    }

    const conditionMet = conditionMatches(
      value,
      source.spec.condition.operator,
      source.spec.condition.threshold,
    );
    let desired: AlertLifecycleState = "normal";
    let activeSince: string | undefined;
    if (conditionMet) {
      activeSince = previous?.conditionMet && previous.activeSince
        ? previous.activeSince
        : now.toISOString();
      const hold = durationToMilliseconds(source.spec.evaluation.for ?? "0s");
      desired = now.getTime() - new Date(activeSince).getTime() >= hold ? "firing" : "pending";
    }
    const record = stateRecord(
      source,
      previous,
      now,
      desired,
      conditionMet,
      value,
      activeSince,
      conditionMet ? "Condition threshold is met." : "Condition threshold is not met.",
    );
    await this.stateStore.set(source.metadata.name, record);
    return this.resultFrom(
      source,
      previous,
      record,
      notificationIntents(source, desired, previous?.state, value),
      response,
    );
  }

  private resultFrom(
    rule: AlertRule,
    previous: AlertStateRecord | undefined,
    record: AlertStateRecord,
    notifications: AlertNotificationIntent[],
    response?: RuntimeExecutionResponse,
  ): AlertEvaluationResult {
    return {
      rule: rule.metadata.name,
      state: record.state,
      ...(previous === undefined ? {} : { previousState: previous.state }),
      changed: previous?.state !== record.state,
      evaluatedAt: record.evaluatedAt,
      ...(record.activeSince === undefined ? {} : { activeSince: record.activeSince }),
      conditionMet: record.conditionMet,
      ...(record.value === undefined ? {} : { value: record.value }),
      ...(record.reason === undefined ? {} : { reason: record.reason }),
      notifications,
      ...(response === undefined
        ? {}
        : { result: response.result, runtimeMetadata: response.metadata }),
    };
  }
}
