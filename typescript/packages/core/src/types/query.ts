import type {
  DatasourceReference,
  ExtensionMap,
  ParameterMap,
  Resource,
  ScalarValue,
} from "./common.js";

export type SignalType = "metrics" | "logs" | "traces" | "tabular";

export interface QueryInput {
  signal: SignalType;
  entity: string;
}

export interface TimeRange {
  field: string;
  from: ScalarValue;
  to: ScalarValue;
}

export type ComparisonOperator =
  | "equals"
  | "notEquals"
  | "greaterThan"
  | "greaterThanOrEqual"
  | "lessThan"
  | "lessThanOrEqual"
  | "in"
  | "notIn"
  | "contains"
  | "notContains"
  | "startsWith"
  | "endsWith"
  | "matches";

export type NullComparisonOperator = "isNull" | "isNotNull";

export type ComparisonExpression =
  | {
      field: string;
      operator: ComparisonOperator;
      value: ScalarValue | ScalarValue[];
    }
  | {
      field: string;
      operator: NullComparisonOperator;
    };

export type BooleanExpression =
  | { and: BooleanExpression[] }
  | { or: BooleanExpression[] }
  | { not: BooleanExpression }
  | ComparisonExpression;

export type ValueExpression =
  | { field: string }
  | { value: ScalarValue }
  | { add: ValueExpression[] }
  | { subtract: [ValueExpression, ValueExpression] }
  | { multiply: ValueExpression[] }
  | { divide: [ValueExpression, ValueExpression] };

export type AggregateFunction =
  | "count"
  | "sum"
  | "avg"
  | "min"
  | "max"
  | "percentile"
  | "distinctCount"
  | "rate"
  | "histogram";

export interface AggregateExpression {
  function: AggregateFunction;
  field?: string;
  percentile?: number;
  interval?: string;
}

export type SelectExpression =
  | { field: string; as?: string }
  | { aggregate: AggregateExpression; as: string }
  | { expression: ValueExpression; as: string };

export type GroupByExpression =
  | { field: string }
  | {
      timeBucket: {
        field: string;
        interval: string;
        as?: string;
      };
    };

export interface OrderByExpression {
  field: string;
  direction: "asc" | "desc";
}

export interface JoinExpression {
  entity: string;
  type?: "inner" | "left";
  on: BooleanExpression;
}

export interface SemanticQuerySpec {
  mode: "semantic";
  datasource: DatasourceReference;
  input: QueryInput;
  timeRange?: TimeRange;
  select: SelectExpression[];
  where?: BooleanExpression;
  groupBy?: GroupByExpression[];
  orderBy?: OrderByExpression[];
  joins?: JoinExpression[];
  limit?: number;
  parameters?: ParameterMap;
  extensions?: ExtensionMap;
}

export interface NativeQuerySpec {
  mode: "native";
  datasource: DatasourceReference;
  native: {
    language: string;
    statement: string;
  };
  parameters?: ParameterMap;
  extensions?: ExtensionMap;
}

export type QuerySpec = SemanticQuerySpec | NativeQuerySpec;

export type Query = Resource<"Query", QuerySpec>;

export type SemanticQuery = Resource<"Query", SemanticQuerySpec>;
export type NativeQuery = Resource<"Query", NativeQuerySpec>;
