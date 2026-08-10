import type { BooleanExpression, ComparisonExpression, SemanticQuery } from "@openplait/core";
import { validateQuery } from "@openplait/core";
import { AdapterError, boundedEpochRange, type CompileContext, type CompiledField, type CompiledQuery } from "@openplait/adapter-sdk";
import type { PrometheusAdapterConfig, PrometheusCompiledRequest } from "./types.js";

export const PROMETHEUS_DATASET = "prometheus.samples";
const BUILTIN_LABELS: Record<string, string> = { "metric.name": "__name__", "service.name": "service_name", job: "job", instance: "instance" };

function fail(code: ConstructorParameters<typeof AdapterError>[0], message: string, path: string): never {
  throw new AdapterError(code, message, { path });
}
function escape(value: string): string { return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/[\r\n\0]/g, " ")}"`; }
function labelName(field: string, config: PrometheusAdapterConfig): string {
  const name = config.labelFields?.[field] ?? BUILTIN_LABELS[field] ?? field;
  if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(name)) fail("FIELD_NOT_FOUND", `Field '${field}' is not mapped to a Prometheus label.`, "/spec/where");
  return name;
}
function comparison(expression: ComparisonExpression, config: PrometheusAdapterConfig): string {
  if (expression.operator === "isNull" || expression.operator === "isNotNull") {
    return `${labelName(expression.field, config)}${expression.operator === "isNull" ? "=" : "!="}\"\"`;
  }
  if (!("value" in expression) || Array.isArray(expression.value)) fail("UNSUPPORTED_OPERATION", "Prometheus label filters require one scalar value.", "/spec/where");
  const value = String(expression.value ?? "");
  const operators: Record<string, string> = { equals: "=", notEquals: "!=", matches: "=~", contains: "=~", notContains: "!~", startsWith: "=~", endsWith: "=~" };
  const op = operators[expression.operator];
  if (!op) fail("UNSUPPORTED_OPERATION", `Prometheus does not support '${expression.operator}' for labels.`, "/spec/where");
  const pattern = expression.operator === "contains" || expression.operator === "notContains" ? `.*${value}.*` : expression.operator === "startsWith" ? `${value}.*` : expression.operator === "endsWith" ? `.*${value}` : value;
  return `${labelName(expression.field, config)}${op}${escape(pattern)}`;
}
function matchers(expression: BooleanExpression | undefined, config: PrometheusAdapterConfig): string[] {
  if (!expression) return [];
  if ("and" in expression) return expression.and.flatMap((item) => matchers(item, config));
  if ("or" in expression || "not" in expression) fail("UNSUPPORTED_OPERATION", "Prometheus semantic selectors currently support conjunctions only.", "/spec/where");
  return [comparison(expression, config)];
}
function stepSeconds(step: string): number {
  const match = step.match(/^(\d+(?:\.\d+)?)(ms|s|m|h|d)$/);
  if (!match) fail("INVALID_PARAMETER", "Prometheus step must be a positive duration such as 30s or 5m.", "/step");
  const multiplier = { ms: .001, s: 1, m: 60, h: 3600, d: 86400 }[match[2] as "ms" | "s" | "m" | "h" | "d"];
  return Number(match[1]) * multiplier;
}
export function compilePrometheusQuery(query: SemanticQuery, config: PrometheusAdapterConfig, context: CompileContext = {}): CompiledQuery<PrometheusCompiledRequest> {
  const validation = validateQuery(query);
  if (!validation.valid) fail("QUERY_VALIDATION_FAILED", "The semantic query is not valid.", "/spec");
  if (query.spec.input.signal !== "metrics" || query.spec.input.entity !== PROMETHEUS_DATASET) fail("DATASET_NOT_FOUND", `Dataset '${query.spec.input.entity}' is not registered.`, "/spec/input/entity");
  if (!query.spec.timeRange) fail("TIME_RANGE_REQUIRED", "Prometheus range queries require a bounded time range.", "/spec/timeRange");
  if (query.spec.joins?.length) fail("UNSUPPORTED_OPERATION", "Prometheus does not support joins.", "/spec/joins");
  const { startMs, endMs } = boundedEpochRange(query.spec.timeRange.from, query.spec.timeRange.to, config.maxTimeRangeMs);
  const step = config.defaultStep ?? "30s";
  stepSeconds(step);
  const selector = `{${matchers(query.spec.where, config).join(",")}}`;
  const aggregate = query.spec.select.find((item) => "aggregate" in item);
  let promql = selector;
  if (aggregate && "aggregate" in aggregate) {
    const fn = aggregate.aggregate.function;
    const groups = (query.spec.groupBy ?? []).flatMap((item) => "field" in item ? [labelName(item.field, config)] : []);
    if (fn === "rate") promql = `rate(${selector}[${step}])`;
    else if (["sum", "avg", "min", "max", "count"].includes(fn)) promql = `${fn}${groups.length ? ` by (${groups.join(",")})` : ""} (${selector})`;
    else fail("UNSUPPORTED_OPERATION", `Prometheus aggregation '${fn}' is not supported by the semantic compiler.`, "/spec/select");
  }
  const fields: CompiledField[] = [
    { name: "timestamp", type: "time", source: "timestamp" },
    { name: "value", type: "number", source: "value" },
    { name: "labels", type: "json", source: "labels" },
  ];
  return {
    kind: "CompiledQuery", language: "promql", compiled: { endpoint: "query_range", promql, start: startMs / 1000, end: endMs / 1000, step },
    parameters: {}, fields, source: { resourceName: query.metadata.name, dataset: PROMETHEUS_DATASET }, warnings: [],
  };
}

export function parsePrometheusStep(step: string): number { return stepSeconds(step); }
