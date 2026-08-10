import type {
  AggregateExpression,
  BooleanExpression,
  ComparisonExpression,
  GroupByExpression,
  ParameterMap,
  ScalarValue,
  SelectExpression,
  SemanticQuery,
  ValueExpression,
} from "@openplait/core";
import { validateQuery } from "@openplait/core";
import {
  AdapterError,
  type CompileContext,
  type CompiledField,
  type CompiledQuery,
} from "@openplait/adapter-sdk";

import { createDatasetRegistry } from "./datasets.js";
import type {
  ClickHouseAdapterConfig,
  ClickHouseCompiledStatement,
  ClickHouseDataset,
  ClickHouseFieldMapping,
} from "./types.js";
import {
  resolveParameterValue,
  scalarClickHouseType,
} from "./parameters.js";

const DEFAULT_MAX_RESULT_ROWS = 10_000;
const DEFAULT_MAX_TIME_RANGE_MS = 31 * 24 * 60 * 60 * 1_000;
const SAFE_OUTPUT_NAME = /^[A-Za-z_][A-Za-z0-9_.]*$/;
const SAFE_IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_]*$/;

class ParameterBinder {
  readonly parameters: Record<string, unknown> = {};
  private nextId = 0;

  bind(value: unknown, clickhouseType: string): string {
    const name = `op_${this.nextId++}`;
    this.parameters[name] = value;
    return `{${name}:${clickhouseType}}`;
  }
}

interface CompilerState {
  binder: ParameterBinder;
  context: CompileContext;
  dataset: ClickHouseDataset;
  parameters: ParameterMap;
}

function adapterError(
  code: ConstructorParameters<typeof AdapterError>[0],
  message: string,
  path: string,
  details?: Record<string, unknown>,
): AdapterError {
  return new AdapterError(code, message, {
    path,
    ...(details === undefined ? {} : { details }),
  });
}

function quoteOutputName(value: string, path: string): string {
  if (!SAFE_OUTPUT_NAME.test(value)) {
    throw adapterError(
      "QUERY_VALIDATION_FAILED",
      `Output name '${value}' is not a safe ClickHouse alias.`,
      path,
    );
  }
  return `\`${value}\``;
}

function quoteTable(value: string): string {
  const parts = value.split(".");
  if (parts.length > 2 || parts.some((part) => !SAFE_IDENTIFIER.test(part))) {
    throw adapterError(
      "QUERY_VALIDATION_FAILED",
      `Table '${value}' is not a safe ClickHouse identifier.`,
      "/spec/input/entity",
    );
  }
  return parts.map((part) => `\`${part}\``).join(".");
}

function fieldMapping(
  dataset: ClickHouseDataset,
  field: string,
  path: string,
): ClickHouseFieldMapping {
  const mapping = dataset.fields[field];
  if (!mapping) {
    throw adapterError(
      "FIELD_NOT_FOUND",
      `Field '${field}' is not defined by dataset '${dataset.name}'.`,
      path,
      { dataset: dataset.name, field },
    );
  }
  return mapping;
}

function compileComparison(
  expression: ComparisonExpression,
  state: CompilerState,
  path: string,
): string {
  const mapping = fieldMapping(state.dataset, expression.field, `${path}/field`);
  const field = mapping.expression;

  if (expression.operator === "isNull") return `isNull(${field})`;
  if (expression.operator === "isNotNull") return `isNotNull(${field})`;
  if (!("value" in expression)) {
    throw adapterError(
      "QUERY_VALIDATION_FAILED",
      `Operator '${expression.operator}' requires a value.`,
      path,
    );
  }

  if (
    ["contains", "notContains", "startsWith", "endsWith", "matches"].includes(
      expression.operator,
    ) &&
    mapping.type !== "string"
  ) {
    throw adapterError(
      "UNSUPPORTED_OPERATION",
      `Operator '${expression.operator}' requires a string field.`,
      `${path}/operator`,
    );
  }

  const value = resolveParameterValue(
    expression.value,
    state.parameters,
    state.context.variables,
    `${path}/value`,
  );

  if (value === null) {
    if (expression.operator === "equals") return `isNull(${field})`;
    if (expression.operator === "notEquals") return `isNotNull(${field})`;
    throw adapterError(
      "INVALID_PARAMETER",
      `Operator '${expression.operator}' cannot compare against null.`,
      `${path}/value`,
    );
  }

  if (expression.operator === "in" || expression.operator === "notIn") {
    if (!Array.isArray(value)) {
      throw adapterError(
        "INVALID_PARAMETER",
        `Operator '${expression.operator}' requires an array value.`,
        `${path}/value`,
      );
    }
    const parameter = state.binder.bind(
      value,
      `Array(${mapping.clickhouseType})`,
    );
    return `${field} ${expression.operator === "in" ? "IN" : "NOT IN"} ${parameter}`;
  }

  if (Array.isArray(value)) {
    throw adapterError(
      "INVALID_PARAMETER",
      `Operator '${expression.operator}' requires a scalar value.`,
      `${path}/value`,
    );
  }

  const parameter = state.binder.bind(value, mapping.clickhouseType);
  switch (expression.operator) {
    case "equals":
      return `${field} = ${parameter}`;
    case "notEquals":
      return `${field} != ${parameter}`;
    case "greaterThan":
      return `${field} > ${parameter}`;
    case "greaterThanOrEqual":
      return `${field} >= ${parameter}`;
    case "lessThan":
      return `${field} < ${parameter}`;
    case "lessThanOrEqual":
      return `${field} <= ${parameter}`;
    case "contains":
      return `position(${field}, ${parameter}) > 0`;
    case "notContains":
      return `position(${field}, ${parameter}) = 0`;
    case "startsWith":
      return `startsWith(${field}, ${parameter})`;
    case "endsWith":
      return `endsWith(${field}, ${parameter})`;
    case "matches":
      return `match(${field}, ${parameter})`;
  }
}

function compileBoolean(
  expression: BooleanExpression,
  state: CompilerState,
  path: string,
): string {
  if ("and" in expression) {
    return `(${expression.and
      .map((item, index) => compileBoolean(item, state, `${path}/and/${index}`))
      .join(" AND ")})`;
  }
  if ("or" in expression) {
    return `(${expression.or
      .map((item, index) => compileBoolean(item, state, `${path}/or/${index}`))
      .join(" OR ")})`;
  }
  if ("not" in expression) {
    return `(NOT ${compileBoolean(expression.not, state, `${path}/not`)})`;
  }
  return compileComparison(expression, state, path);
}

function compileValueExpression(
  expression: ValueExpression,
  state: CompilerState,
  path: string,
): string {
  if ("field" in expression) {
    const mapping = fieldMapping(state.dataset, expression.field, `${path}/field`);
    if (mapping.type !== "number" && mapping.type !== "duration") {
      throw adapterError(
        "UNSUPPORTED_OPERATION",
        `Arithmetic requires numeric fields; '${expression.field}' is '${mapping.type}'.`,
        `${path}/field`,
      );
    }
    return mapping.expression;
  }
  if ("value" in expression) {
    const value = resolveParameterValue(
      expression.value,
      state.parameters,
      state.context.variables,
      `${path}/value`,
    );
    if (Array.isArray(value)) {
      throw adapterError(
        "INVALID_PARAMETER",
        "Arithmetic expressions cannot contain array values.",
        `${path}/value`,
      );
    }
    return state.binder.bind(value, scalarClickHouseType(value));
  }

  let operator: "add" | "subtract" | "multiply" | "divide";
  let operands: readonly ValueExpression[];
  let sqlOperator: "+" | "-" | "*" | "/";
  if ("add" in expression) {
    operator = "add";
    operands = expression.add;
    sqlOperator = "+";
  } else if ("subtract" in expression) {
    operator = "subtract";
    operands = expression.subtract;
    sqlOperator = "-";
  } else if ("multiply" in expression) {
    operator = "multiply";
    operands = expression.multiply;
    sqlOperator = "*";
  } else {
    operator = "divide";
    operands = expression.divide;
    sqlOperator = "/";
  }
  return `(${operands
    .map((operand, index) =>
      compileValueExpression(operand, state, `${path}/${operator}/${index}`),
    )
    .join(` ${sqlOperator} `)})`;
}

function parseInterval(interval: string, path: string): string {
  const match = /^(\d+)(ms|s|m|h|d)$/.exec(interval);
  if (!match || Number(match[1]) < 1) {
    throw adapterError(
      "INVALID_PARAMETER",
      `Interval '${interval}' must be a positive integer followed by ms, s, m, h, or d.`,
      path,
    );
  }
  const unit = {
    ms: "MILLISECOND",
    s: "SECOND",
    m: "MINUTE",
    h: "HOUR",
    d: "DAY",
  }[match[2] as "ms" | "s" | "m" | "h" | "d"];
  return `INTERVAL ${match[1]} ${unit}`;
}

function compileGroupBy(
  group: GroupByExpression,
  state: CompilerState,
  path: string,
): string {
  if ("field" in group) {
    return fieldMapping(state.dataset, group.field, `${path}/field`).expression;
  }
  const field = fieldMapping(
    state.dataset,
    group.timeBucket.field,
    `${path}/timeBucket/field`,
  );
  const interval = parseInterval(
    group.timeBucket.interval,
    `${path}/timeBucket/interval`,
  );
  return `toStartOfInterval(${field.expression}, ${interval})`;
}

function timeBucketForField(
  field: string,
  groups: GroupByExpression[] | undefined,
): Extract<GroupByExpression, { timeBucket: unknown }> | undefined {
  return groups?.find(
    (group): group is Extract<GroupByExpression, { timeBucket: unknown }> =>
      "timeBucket" in group && group.timeBucket.field === field,
  );
}

function compileAggregate(
  aggregate: AggregateExpression,
  state: CompilerState,
  path: string,
): { expression: string; type: CompiledField["type"]; unit?: string } {
  const mapping = aggregate.field
    ? fieldMapping(state.dataset, aggregate.field, `${path}/field`)
    : undefined;
  const field = mapping?.expression;
  if (
    mapping &&
    ["sum", "avg", "min", "max", "percentile", "rate", "histogram"].includes(
      aggregate.function,
    ) &&
    mapping.type !== "number" &&
    mapping.type !== "duration"
  ) {
    throw adapterError(
      "UNSUPPORTED_OPERATION",
      `Aggregate '${aggregate.function}' requires a numeric field.`,
      `${path}/field`,
    );
  }

  switch (aggregate.function) {
    case "count":
      return { expression: field ? `count(${field})` : "count()", type: "number" };
    case "sum":
    case "avg":
    case "min":
    case "max":
      if (!field) {
        throw adapterError(
          "QUERY_VALIDATION_FAILED",
          `Aggregate '${aggregate.function}' requires a field.`,
          path,
        );
      }
      return {
        expression: `${aggregate.function}(${field})`,
        type: "number",
        ...(mapping?.unit === undefined ? {} : { unit: mapping.unit }),
      };
    case "percentile": {
      if (!field || aggregate.percentile === undefined) {
        throw adapterError(
          "QUERY_VALIDATION_FAILED",
          "Percentile requires a field and percentile value.",
          path,
        );
      }
      return {
        expression: `quantile(${aggregate.percentile / 100})(${field})`,
        type: "number",
        ...(mapping?.unit === undefined ? {} : { unit: mapping.unit }),
      };
    }
    case "distinctCount":
      if (!field) {
        throw adapterError(
          "QUERY_VALIDATION_FAILED",
          "Distinct count requires a field.",
          path,
        );
      }
      return { expression: `uniqExact(${field})`, type: "number" };
    case "rate": {
      if (!field) {
        throw adapterError(
          "QUERY_VALIDATION_FAILED",
          "Rate requires a field.",
          path,
        );
      }
      const timestamp = fieldMapping(
        state.dataset,
        state.dataset.timeField,
        "/spec/input/entity",
      ).expression;
      return {
        expression: `sum(${field}) / greatest(dateDiff('second', min(${timestamp}), max(${timestamp})), 1)`,
        type: "number",
        ...(mapping?.unit === undefined ? {} : { unit: `${mapping.unit}/s` }),
      };
    }
    case "histogram": {
      if (!field || !aggregate.interval || !/^\d+$/.test(aggregate.interval)) {
        throw adapterError(
          "INVALID_PARAMETER",
          "Histogram requires a field and a positive integer bin count in interval.",
          `${path}/interval`,
        );
      }
      const bins = Number(aggregate.interval);
      if (bins < 1 || bins > 1_000) {
        throw adapterError(
          "INVALID_PARAMETER",
          "Histogram bin count must be between 1 and 1000.",
          `${path}/interval`,
        );
      }
      return { expression: `histogram(${bins})(${field})`, type: "json" };
    }
  }
}

function selectOutputName(select: SelectExpression): string {
  if ("as" in select && select.as) return select.as;
  if ("field" in select) return select.field;
  throw new AdapterError(
    "QUERY_VALIDATION_FAILED",
    "Calculated and aggregate fields require an output alias.",
  );
}

function valueExpressionFields(expression: ValueExpression): string[] {
  if ("field" in expression) return [expression.field];
  if ("value" in expression) return [];
  if ("add" in expression) return expression.add.flatMap(valueExpressionFields);
  if ("subtract" in expression) return expression.subtract.flatMap(valueExpressionFields);
  if ("multiply" in expression) return expression.multiply.flatMap(valueExpressionFields);
  return expression.divide.flatMap(valueExpressionFields);
}

function validateGrouping(query: SemanticQuery): void {
  const groupedFields = new Set(
    (query.spec.groupBy ?? []).map((group) =>
      "field" in group ? group.field : group.timeBucket.field,
    ),
  );
  const hasAggregate = query.spec.select.some((select) => "aggregate" in select);
  for (const [index, select] of query.spec.select.entries()) {
    if ("aggregate" in select) continue;
    const fields = "field" in select
      ? [select.field]
      : valueExpressionFields(select.expression);
    if ((hasAggregate || groupedFields.size > 0) && fields.some((field) => !groupedFields.has(field))) {
      throw adapterError(
        "QUERY_VALIDATION_FAILED",
        "Every non-aggregate selected field must appear in groupBy when grouping or aggregation is used.",
        `/spec/select/${index}`,
        { fields, groupedFields: [...groupedFields] },
      );
    }
  }
}

function compileSelect(
  select: SelectExpression,
  index: number,
  query: SemanticQuery,
  state: CompilerState,
): { sql: string; field: CompiledField } {
  const path = `/spec/select/${index}`;
  const name = selectOutputName(select);
  const alias = quoteOutputName(name, `${path}/as`);

  if ("field" in select) {
    const mapping = fieldMapping(state.dataset, select.field, `${path}/field`);
    const bucket = timeBucketForField(select.field, query.spec.groupBy);
    const expression = bucket
      ? compileGroupBy(bucket, state, "/spec/groupBy")
      : mapping.expression;
    return {
      sql: `${expression} AS ${alias}`,
      field: {
        name,
        type: mapping.type,
        source: select.field,
        ...(mapping.unit === undefined ? {} : { unit: mapping.unit }),
      },
    };
  }

  if ("aggregate" in select) {
    const aggregate = compileAggregate(
      select.aggregate,
      state,
      `${path}/aggregate`,
    );
    return {
      sql: `${aggregate.expression} AS ${alias}`,
      field: {
        name,
        type: aggregate.type,
        ...(aggregate.unit === undefined ? {} : { unit: aggregate.unit }),
      },
    };
  }

  return {
    sql: `${compileValueExpression(select.expression, state, `${path}/expression`)} AS ${alias}`,
    field: { name, type: "number" },
  };
}

function resolvedTime(value: ScalarValue | ScalarValue[], path: string): number {
  if (Array.isArray(value) || value === null || typeof value === "boolean") {
    throw adapterError("INVALID_PARAMETER", "Time values must be strings or numbers.", path);
  }
  const milliseconds =
    typeof value === "number" ? value : Date.parse(value);
  if (!Number.isFinite(milliseconds)) {
    throw adapterError("INVALID_PARAMETER", `Time value '${value}' is invalid.`, path);
  }
  return milliseconds;
}

function compileTimeRange(
  query: SemanticQuery,
  state: CompilerState,
  maxTimeRangeMs: number,
  requireTimeRange: boolean,
): string | undefined {
  const range = query.spec.timeRange;
  if (!range) {
    if (requireTimeRange) {
      throw adapterError(
        "TIME_RANGE_REQUIRED",
        `Dataset '${state.dataset.name}' requires a time range.`,
        "/spec/timeRange",
      );
    }
    return undefined;
  }

  const mapping = fieldMapping(state.dataset, range.field, "/spec/timeRange/field");
  if (mapping.type !== "time") {
    throw adapterError(
      "QUERY_VALIDATION_FAILED",
      `Time range field '${range.field}' is not a time field.`,
      "/spec/timeRange/field",
    );
  }
  const from = resolveParameterValue(
    range.from,
    state.parameters,
    state.context.variables,
    "/spec/timeRange/from",
  );
  const to = resolveParameterValue(
    range.to,
    state.parameters,
    state.context.variables,
    "/spec/timeRange/to",
  );
  const fromMs = resolvedTime(from, "/spec/timeRange/from");
  const toMs = resolvedTime(to, "/spec/timeRange/to");
  if (toMs < fromMs) {
    throw adapterError(
      "INVALID_PARAMETER",
      "Time range end must not precede its start.",
      "/spec/timeRange",
    );
  }
  if (toMs - fromMs > maxTimeRangeMs) {
    throw adapterError(
      "TIME_RANGE_TOO_LARGE",
      `Time range exceeds the configured maximum of ${maxTimeRangeMs}ms.`,
      "/spec/timeRange",
      { requestedMs: toMs - fromMs, maxTimeRangeMs },
    );
  }

  const fromParameter = state.binder.bind(from, "DateTime64(9)");
  const toParameter = state.binder.bind(to, "DateTime64(9)");
  return `${mapping.expression} BETWEEN ${fromParameter} AND ${toParameter}`;
}

function resolveLimit(
  query: SemanticQuery,
  config: ClickHouseAdapterConfig,
  context: CompileContext,
): number {
  const configured = config.maxResultRows ?? DEFAULT_MAX_RESULT_ROWS;
  const contextual = context.maxResultRows ?? configured;
  const maximum = Math.min(configured, contextual);
  const requested = query.spec.limit ?? maximum;
  if (!Number.isInteger(requested) || requested < 1 || requested > maximum) {
    throw adapterError(
      "QUERY_LIMIT_EXCEEDED",
      `Query limit ${requested} exceeds the allowed maximum of ${maximum}.`,
      "/spec/limit",
      { requested, maximum },
    );
  }
  return requested;
}

export function compileClickHouseQuery(
  query: SemanticQuery,
  config: ClickHouseAdapterConfig,
  context: CompileContext = {},
): CompiledQuery<ClickHouseCompiledStatement> {
  const validation = validateQuery(query);
  if (!validation.valid) {
    throw new AdapterError(
      "QUERY_VALIDATION_FAILED",
      "The semantic query is not valid.",
      { details: { errors: validation.errors } },
    );
  }
  if (query.spec.mode !== "semantic") {
    throw new AdapterError(
      "QUERY_VALIDATION_FAILED",
      "The ClickHouse semantic compiler only accepts semantic queries.",
    );
  }
  if (query.spec.joins?.length) {
    throw adapterError(
      "UNSUPPORTED_OPERATION",
      "ClickHouse semantic joins are not supported in this release.",
      "/spec/joins",
    );
  }
  validateGrouping(query);

  const datasets = createDatasetRegistry(config.datasets ?? []);
  const dataset = datasets.get(query.spec.input.entity);
  if (!dataset) {
    throw adapterError(
      "DATASET_NOT_FOUND",
      `Dataset '${query.spec.input.entity}' is not registered.`,
      "/spec/input/entity",
    );
  }
  if (dataset.signal !== query.spec.input.signal) {
    throw adapterError(
      "QUERY_VALIDATION_FAILED",
      `Dataset '${dataset.name}' carries '${dataset.signal}', not '${query.spec.input.signal}'.`,
      "/spec/input/signal",
    );
  }

  const state: CompilerState = {
    binder: new ParameterBinder(),
    context,
    dataset,
    parameters: query.spec.parameters ?? {},
  };
  const selected = query.spec.select.map((select, index) =>
    compileSelect(select, index, query, state),
  );

  const filters: string[] = [];
  const timeFilter = compileTimeRange(
    query,
    state,
    config.maxTimeRangeMs ?? DEFAULT_MAX_TIME_RANGE_MS,
    config.requireTimeRange ?? true,
  );
  if (timeFilter) filters.push(timeFilter);
  if (dataset.defaultFilter) {
    filters.push(compileBoolean(dataset.defaultFilter, state, "/dataset/defaultFilter"));
  }
  if (config.tenant) {
    filters.push(
      compileBoolean(
        {
          field: config.tenant.field,
          operator: "equals",
          value: config.tenant.value,
        },
        state,
        "/config/tenant",
      ),
    );
  }
  if (query.spec.where) {
    filters.push(compileBoolean(query.spec.where, state, "/spec/where"));
  }

  const groups = query.spec.groupBy?.map((group, index) =>
    compileGroupBy(group, state, `/spec/groupBy/${index}`),
  );
  const outputNames = new Set(selected.map(({ field }) => field.name));
  const order = query.spec.orderBy?.map((item, index) => {
    const expression = outputNames.has(item.field)
      ? quoteOutputName(item.field, `/spec/orderBy/${index}/field`)
      : fieldMapping(
          dataset,
          item.field,
          `/spec/orderBy/${index}/field`,
        ).expression;
    return `${expression} ${item.direction.toUpperCase()}`;
  });
  const limit = resolveLimit(query, config, context);

  const lines = [
    "SELECT",
    selected.map(({ sql }) => `  ${sql}`).join(",\n"),
    `FROM ${quoteTable(dataset.table)}`,
  ];
  if (dataset.arrayJoin) {
    if (!SAFE_IDENTIFIER.test(dataset.arrayJoin)) {
      throw adapterError(
        "QUERY_VALIDATION_FAILED",
        `Array join '${dataset.arrayJoin}' is not a safe identifier.`,
        "/spec/input/entity",
      );
    }
    lines.push(`ARRAY JOIN \`${dataset.arrayJoin}\``);
  }
  if (filters.length) lines.push(`WHERE ${filters.join("\n  AND ")}`);
  if (groups?.length) lines.push(`GROUP BY ${groups.join(", ")}`);
  if (order?.length) lines.push(`ORDER BY ${order.join(", ")}`);
  lines.push(`LIMIT ${limit}`);

  return {
    kind: "CompiledQuery",
    language: "sql",
    compiled: { statement: lines.join("\n") },
    parameters: state.binder.parameters,
    fields: selected.map(({ field }) => field),
    source: {
      resourceName: query.metadata.name,
      dataset: dataset.name,
    },
    warnings: [],
  };
}
