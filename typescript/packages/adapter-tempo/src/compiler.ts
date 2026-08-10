import type {
  BooleanExpression,
  ComparisonExpression,
  DataFieldType,
  ScalarValue,
  SemanticQuery,
} from "@openplait/core";
import { validateQuery } from "@openplait/core";
import {
  AdapterError,
  type CompileContext,
  type CompiledField,
  type CompiledQuery,
} from "@openplait/adapter-sdk";

import { TEMPO_DATASET_NAME, TEMPO_TRACE_FIELDS, type TempoFieldMapping } from "./datasets.js";
import { resolveParameterValue } from "./parameters.js";
import type { TempoAdapterConfig, TempoCompiledRequest } from "./types.js";

const DEFAULT_MAX_RESULT_ROWS = 1_000;
const DEFAULT_MAX_SPANS_PER_SPAN_SET = 100;
const DEFAULT_MAX_TIME_RANGE_MS = 31 * 24 * 60 * 60 * 1_000;

function boundedEpochSeconds(
  fromMs: number,
  toMs: number,
  maxTimeRangeMs: number,
): { start: number; end: number } {
  let start = Math.floor(fromMs / 1_000);
  const end = Math.ceil(toMs / 1_000);
  const maxSeconds = Math.floor(maxTimeRangeMs / 1_000);
  if (end - start > maxSeconds) start = end - maxSeconds;
  return { start, end };
}
const SAFE_ATTRIBUTE = /^[A-Za-z_][A-Za-z0-9_.\/-]*$/;

function tempoVersionAtLeast(version: string | undefined, major: number, minor: number): boolean {
  if (!version) return false;
  const match = version.trim().replace(/^v/i, "").match(/^(\d+)\.(\d+)/);
  if (!match) return false;
  const actualMajor = Number(match[1]);
  const actualMinor = Number(match[2]);
  return actualMajor > major || (actualMajor === major && actualMinor >= minor);
}

export function supportsTempoMostRecent(config: TempoAdapterConfig): boolean {
  return config.enableMostRecent ?? tempoVersionAtLeast(config.tempoVersion, 2, 8);
}

function fail(
  code: ConstructorParameters<typeof AdapterError>[0],
  message: string,
  path: string,
  details?: Record<string, unknown>,
): never {
  throw new AdapterError(code, message, {
    path,
    ...(details === undefined ? {} : { details }),
  });
}

function fields(config: TempoAdapterConfig): Readonly<Record<string, TempoFieldMapping>> {
  const custom = Object.fromEntries(
    Object.entries(config.attributeFields ?? {}).map(([name, mapping]) => {
      if (!SAFE_ATTRIBUTE.test(mapping.attribute)) {
        fail("CONFIG_INVALID", `Tempo attribute '${mapping.attribute}' is invalid.`, `/attributeFields/${name}/attribute`);
      }
      return [
        name,
        {
          traceql: `${mapping.scope}.${mapping.attribute}`,
          type: mapping.type ?? "string",
          selectable: false,
          valueKind: mapping.type ?? "string",
        } satisfies TempoFieldMapping,
      ];
    }),
  );
  return { ...TEMPO_TRACE_FIELDS, ...custom };
}

function fieldMapping(
  registry: Readonly<Record<string, TempoFieldMapping>>,
  fieldName: string,
  path: string,
): TempoFieldMapping {
  const mapping = registry[fieldName];
  if (!mapping) {
    fail("FIELD_NOT_FOUND", `Field '${fieldName}' is not defined by '${TEMPO_DATASET_NAME}'.`, path, {
      dataset: TEMPO_DATASET_NAME,
      field: fieldName,
    });
  }
  return mapping;
}

function escapeString(value: string): string {
  return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/[\r\n\0]/g, " ")}"`;
}

function escapeRegex(value: string): string {
  return value.replace(/[\\^$.*+?()[\]{}|]/g, "\\$&");
}

function durationLiteral(value: ScalarValue, path: string): string {
  if (typeof value === "number" && Number.isFinite(value) && value >= 0) return `${value}ms`;
  if (typeof value === "string" && /^(?:\d+(?:\.\d+)?)(?:ns|us|µs|ms|s|m|h)$/.test(value)) return value;
  fail("INVALID_PARAMETER", "Duration values must be non-negative milliseconds or a TraceQL duration string.", path);
}

function enumLiteral(value: ScalarValue, kind: "status" | "kind", path: string): string {
  if (typeof value !== "string") fail("INVALID_PARAMETER", `${kind} values must be strings.`, path);
  const normalized = value.toLowerCase().replace(/^span_/, "").replace(/^status_/, "").replace(/^kind_/, "");
  const allowed = kind === "status"
    ? ["unset", "ok", "error"]
    : ["unspecified", "internal", "server", "client", "producer", "consumer"];
  if (!allowed.includes(normalized)) fail("INVALID_PARAMETER", `Unknown Tempo ${kind} '${value}'.`, path);
  return normalized;
}

function literal(value: ScalarValue, mapping: TempoFieldMapping, path: string): string {
  if (value === null) return "nil";
  if (mapping.valueKind === "duration") return durationLiteral(value, path);
  if (mapping.valueKind === "status" || mapping.valueKind === "kind") return enumLiteral(value, mapping.valueKind, path);
  if (mapping.valueKind === "traceId") {
    if (typeof value !== "string" || !/^[A-Fa-f0-9]{16,32}$/.test(value)) {
      fail("INVALID_PARAMETER", "Trace IDs must contain 16 to 32 hexadecimal characters.", path);
    }
    return escapeString(value);
  }
  if (typeof value === "string") return escapeString(value);
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  if (typeof value === "boolean") return String(value);
  fail("INVALID_PARAMETER", "TraceQL values must be finite scalars.", path);
}

function regexComparison(
  operator: "contains" | "notContains" | "startsWith" | "endsWith" | "matches",
  fieldName: string,
  value: ScalarValue,
  path: string,
  negated = false,
): string {
  if (typeof value !== "string") fail("INVALID_PARAMETER", `Operator '${operator}' requires a string value.`, path);
  const source = operator === "matches" ? value : escapeRegex(value);
  const pattern = operator === "contains" || operator === "notContains"
    ? `.*${source}.*`
    : operator === "startsWith"
      ? `${source}.*`
      : operator === "endsWith"
        ? `.*${source}`
        : source;
  const negativeOperator = operator === "notContains" ? !negated : negated;
  return `${fieldName} ${negativeOperator ? "!~" : "=~"} ${escapeString(pattern)}`;
}

function compileComparison(
  expression: ComparisonExpression,
  registry: Readonly<Record<string, TempoFieldMapping>>,
  queryParameters: SemanticQuery["spec"]["parameters"],
  variables: CompileContext["variables"],
  path: string,
  negated = false,
): string {
  const mapping = fieldMapping(registry, expression.field, `${path}/field`);
  if (!mapping.traceql) fail("UNSUPPORTED_OPERATION", `Field '${expression.field}' cannot be used in a TraceQL filter.`, `${path}/field`);
  if (expression.operator === "isNull") return `${mapping.traceql} ${negated ? "!=" : "="} nil`;
  if (expression.operator === "isNotNull") return `${mapping.traceql} ${negated ? "=" : "!="} nil`;
  if (!("value" in expression)) fail("QUERY_VALIDATION_FAILED", `Operator '${expression.operator}' requires a value.`, path);
  const resolved = resolveParameterValue(expression.value, queryParameters ?? {}, variables, `${path}/value`);

  if (expression.operator === "in" || expression.operator === "notIn") {
    if (!Array.isArray(resolved) || resolved.length === 0) fail("INVALID_PARAMETER", `Operator '${expression.operator}' requires a non-empty array.`, `${path}/value`);
    const isIn = expression.operator === "in" ? !negated : negated;
    const joiner = isIn ? " || " : " && ";
    const operator = isIn ? "=" : "!=";
    return `(${resolved.map((item) => `${mapping.traceql} ${operator} ${literal(item, mapping, `${path}/value`)}`).join(joiner)})`;
  }
  if (Array.isArray(resolved)) fail("INVALID_PARAMETER", `Operator '${expression.operator}' requires a scalar value.`, `${path}/value`);
  if (["contains", "notContains", "startsWith", "endsWith", "matches"].includes(expression.operator)) {
    if (mapping.type !== "string") fail("UNSUPPORTED_OPERATION", `Operator '${expression.operator}' requires a string field.`, `${path}/operator`);
    return regexComparison(
      expression.operator as "contains" | "notContains" | "startsWith" | "endsWith" | "matches",
      mapping.traceql,
      resolved,
      `${path}/value`,
      negated,
    );
  }
  const operators = {
    equals: "=",
    notEquals: "!=",
    greaterThan: ">",
    greaterThanOrEqual: ">=",
    lessThan: "<",
    lessThanOrEqual: "<=",
  } as const;
  const negatedOperators = {
    equals: "!=",
    notEquals: "=",
    greaterThan: "<=",
    greaterThanOrEqual: "<",
    lessThan: ">=",
    lessThanOrEqual: ">",
  } as const;
  const operator = (negated ? negatedOperators : operators)[
    expression.operator as keyof typeof operators
  ];
  if (!operator) fail("UNSUPPORTED_OPERATION", `Operator '${expression.operator}' is not supported.`, `${path}/operator`);
  return `${mapping.traceql} ${operator} ${literal(resolved, mapping, `${path}/value`)}`;
}

function compileBoolean(
  expression: BooleanExpression,
  registry: Readonly<Record<string, TempoFieldMapping>>,
  queryParameters: SemanticQuery["spec"]["parameters"],
  variables: CompileContext["variables"],
  path: string,
  negated = false,
): string {
  if ("and" in expression) {
    if (!expression.and.length) fail("QUERY_VALIDATION_FAILED", "AND expressions cannot be empty.", path);
    return `(${expression.and.map((item, index) => compileBoolean(item, registry, queryParameters, variables, `${path}/and/${index}`, negated)).join(negated ? " || " : " && ")})`;
  }
  if ("or" in expression) {
    if (!expression.or.length) fail("QUERY_VALIDATION_FAILED", "OR expressions cannot be empty.", path);
    return `(${expression.or.map((item, index) => compileBoolean(item, registry, queryParameters, variables, `${path}/or/${index}`, negated)).join(negated ? " && " : " || ")})`;
  }
  if ("not" in expression) {
    return compileBoolean(expression.not, registry, queryParameters, variables, `${path}/not`, !negated);
  }
  return compileComparison(expression, registry, queryParameters, variables, path, negated);
}

function timeValue(value: ScalarValue | ScalarValue[], parameters: SemanticQuery["spec"]["parameters"], context: CompileContext, path: string): number {
  const resolved = resolveParameterValue(value, parameters ?? {}, context.variables, path);
  if (Array.isArray(resolved) || resolved === null || typeof resolved === "boolean") fail("INVALID_PARAMETER", "Time values must be strings or epoch milliseconds.", path);
  const milliseconds = typeof resolved === "number" ? resolved : Date.parse(resolved);
  if (!Number.isFinite(milliseconds)) fail("INVALID_PARAMETER", `Time value '${resolved}' is invalid.`, path);
  return milliseconds;
}

function positiveLimit(requested: number | undefined, maximum: number, path: string): number {
  const value = requested ?? maximum;
  if (!Number.isInteger(value) || value < 1 || value > maximum) {
    fail("QUERY_LIMIT_EXCEEDED", `Query limit ${value} exceeds the allowed maximum of ${maximum}.`, path, { requested: value, maximum });
  }
  return value;
}

export function compileTempoQuery(
  query: SemanticQuery,
  config: TempoAdapterConfig,
  context: CompileContext = {},
): CompiledQuery<TempoCompiledRequest> {
  const validation = validateQuery(query);
  if (!validation.valid) throw new AdapterError("QUERY_VALIDATION_FAILED", "The semantic query is not valid.", { details: { errors: validation.errors } });
  if (query.spec.mode !== "semantic") fail("QUERY_VALIDATION_FAILED", "The Tempo semantic compiler only accepts semantic queries.", "/spec/mode");
  if (query.spec.input.entity !== TEMPO_DATASET_NAME) fail("DATASET_NOT_FOUND", `Dataset '${query.spec.input.entity}' is not registered.`, "/spec/input/entity");
  if (query.spec.input.signal !== "traces") fail("QUERY_VALIDATION_FAILED", "Tempo trace search requires the 'traces' signal.", "/spec/input/signal");
  if (!query.spec.timeRange) fail("TIME_RANGE_REQUIRED", "Tempo search requires a bounded time range.", "/spec/timeRange");
  if (query.spec.timeRange.field !== "timestamp") fail("QUERY_VALIDATION_FAILED", "Tempo search time ranges must use the 'timestamp' field.", "/spec/timeRange/field");
  if (query.spec.groupBy?.length || query.spec.joins?.length || query.spec.select.some((item) => !("field" in item))) {
    fail("UNSUPPORTED_OPERATION", "Tempo trace search supports field projection and filtering, not grouping, joins, arithmetic, or aggregation.", "/spec");
  }
  if (query.spec.orderBy?.some((item) => item.field !== "timestamp" || item.direction !== "desc")) {
    fail("UNSUPPORTED_OPERATION", "Tempo only supports newest-first timestamp ordering.", "/spec/orderBy");
  }

  const registry = fields(config);
  const selected: CompiledField[] = query.spec.select.map((item, index) => {
    if (!("field" in item)) fail("UNSUPPORTED_OPERATION", "Tempo search only supports direct field projection.", `/spec/select/${index}`);
    const mapping = fieldMapping(registry, item.field, `/spec/select/${index}/field`);
    if (!mapping.selectable) fail("UNSUPPORTED_OPERATION", `Field '${item.field}' is filter-only in Tempo search results.`, `/spec/select/${index}/field`);
    return {
      name: item.as ?? item.field,
      type: mapping.type,
      source: item.field,
      ...(mapping.unit === undefined ? {} : { unit: mapping.unit }),
    };
  });

  const fromMs = timeValue(query.spec.timeRange.from, query.spec.parameters, context, "/spec/timeRange/from");
  const toMs = timeValue(query.spec.timeRange.to, query.spec.parameters, context, "/spec/timeRange/to");
  if (toMs < fromMs) fail("INVALID_PARAMETER", "Time range end must not precede its start.", "/spec/timeRange");
  const maxTimeRangeMs = config.maxTimeRangeMs ?? DEFAULT_MAX_TIME_RANGE_MS;
  if (toMs - fromMs > maxTimeRangeMs) fail("TIME_RANGE_TOO_LARGE", `Time range exceeds the configured maximum of ${maxTimeRangeMs}ms.`, "/spec/timeRange", { requestedMs: toMs - fromMs, maxTimeRangeMs });

  const maximum = Math.min(config.maxResultRows ?? DEFAULT_MAX_RESULT_ROWS, context.maxResultRows ?? Number.POSITIVE_INFINITY);
  const limit = positiveLimit(query.spec.limit, maximum, "/spec/limit");
  const spansPerSpanSet = config.maxSpansPerSpanSet ?? DEFAULT_MAX_SPANS_PER_SPAN_SET;
  const filter = query.spec.where ? ` ${compileBoolean(query.spec.where, registry, query.spec.parameters, context.variables, "/spec/where")} ` : " ";
  const boundedRange = boundedEpochSeconds(fromMs, toMs, maxTimeRangeMs);

  return {
    kind: "CompiledQuery",
    language: "traceql",
    compiled: {
      endpoint: "search",
      traceql: `{${filter}}${query.spec.orderBy?.length && supportsTempoMostRecent(config) ? " with (most_recent=true)" : ""}`,
      start: boundedRange.start,
      end: boundedRange.end,
      limit,
      spansPerSpanSet,
    },
    parameters: {},
    fields: selected,
    source: { resourceName: query.metadata.name, dataset: TEMPO_DATASET_NAME },
    warnings: [],
  };
}

export function tempoFieldRegistry(config: TempoAdapterConfig): Readonly<Record<string, TempoFieldMapping>> {
  return fields(config);
}
