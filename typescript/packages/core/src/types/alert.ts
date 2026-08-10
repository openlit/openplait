import type { ExtensionMap, Resource } from "./common.js";
import type { QuerySpec } from "./query.js";
import type { Transformation } from "./transformation.js";

export type AlertLifecycleState =
  | "normal"
  | "pending"
  | "firing"
  | "no_data"
  | "error"
  | "suppressed";

export type AlertComparisonOperator =
  | "equals"
  | "notEquals"
  | "greaterThan"
  | "greaterThanOrEqual"
  | "lessThan"
  | "lessThanOrEqual";

export type AlertReducer = "first" | "last" | "min" | "max" | "mean" | "sum" | "count";

export interface AlertCondition {
  field: string;
  operator: AlertComparisonOperator;
  threshold: number;
  reducer?: AlertReducer;
}

export interface AlertEvaluationPolicy {
  every: string;
  lookback?: string;
  for?: string;
  noDataState?: "no_data" | "normal" | "firing";
  errorState?: "error" | "normal" | "firing";
}

export type AlertNotificationEvent = "firing" | "resolved" | "error" | "no_data";

export interface AlertNotificationReference {
  channelRef: string;
  notifyOn?: AlertNotificationEvent[];
}

export interface AlertRuleSpec {
  enabled?: boolean;
  query: {
    kind: "Query";
    spec: QuerySpec;
  };
  transformations?: Transformation[];
  condition: AlertCondition;
  evaluation: AlertEvaluationPolicy;
  labels?: Record<string, string>;
  annotations?: Record<string, string>;
  notifications?: AlertNotificationReference[];
  extensions?: ExtensionMap;
}

export type AlertRule = Resource<"AlertRule", AlertRuleSpec>;
