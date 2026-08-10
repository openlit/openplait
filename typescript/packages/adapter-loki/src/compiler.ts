import type { BooleanExpression, ComparisonExpression, SemanticQuery } from "@openplait/core";
import { validateQuery } from "@openplait/core";
import { AdapterError, boundedEpochRange, type CompileContext, type CompiledQuery } from "@openplait/adapter-sdk";
import type { LokiAdapterConfig, LokiCompiledRequest } from "./types.js";

export const LOKI_DATASET = "loki.logs";
const BUILTIN_LABELS: Record<string, string> = { "service.name": "service_name", severity: "level", "trace.id": "trace_id", "span.id": "span_id", job: "job", instance: "instance" };
function fail(code: ConstructorParameters<typeof AdapterError>[0], message: string, path: string): never { throw new AdapterError(code, message, { path }); }
function escape(value: string): string { return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/[\r\n\0]/g, " ")}"`; }
function label(field: string, config: LokiAdapterConfig): string { const value = config.labelFields?.[field] ?? BUILTIN_LABELS[field] ?? field; if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(value)) fail("FIELD_NOT_FOUND", `Field '${field}' is not mapped to a Loki label.`, "/spec/where"); return value; }
function clauses(expression: BooleanExpression | undefined, config: LokiAdapterConfig): { labels: string[]; lines: string[] } {
  if (!expression) return { labels: [], lines: [] };
  if ("and" in expression) return expression.and.reduce((all, item) => { const next = clauses(item, config); all.labels.push(...next.labels); all.lines.push(...next.lines); return all; }, { labels: [] as string[], lines: [] as string[] });
  if ("or" in expression || "not" in expression) fail("UNSUPPORTED_OPERATION", "Loki semantic selectors currently support conjunctions only.", "/spec/where");
  const item = expression as ComparisonExpression;
  if (item.field === "body" || item.field === "message") {
    if (!("value" in item) || typeof item.value !== "string") fail("INVALID_PARAMETER", "Loki line filters require a string.", "/spec/where");
    const op = item.operator === "contains" || item.operator === "equals" ? "|=" : item.operator === "notContains" || item.operator === "notEquals" ? "!=" : item.operator === "matches" ? "|~" : undefined;
    if (!op) fail("UNSUPPORTED_OPERATION", `Loki line operator '${item.operator}' is unsupported.`, "/spec/where");
    return { labels: [], lines: [`${op} ${escape(item.value)}`] };
  }
  if (item.operator === "isNull" || item.operator === "isNotNull") return { labels: [`${label(item.field, config)}${item.operator === "isNull" ? "=" : "!="}\"\"`], lines: [] };
  if (!("value" in item) || Array.isArray(item.value)) fail("INVALID_PARAMETER", "Loki label filters require one scalar value.", "/spec/where");
  const operators: Record<string, string> = { equals: "=", notEquals: "!=", matches: "=~", contains: "=~", notContains: "!~" };
  const op = operators[item.operator];
  if (!op) fail("UNSUPPORTED_OPERATION", `Loki label operator '${item.operator}' is unsupported.`, "/spec/where");
  const value = item.operator === "contains" || item.operator === "notContains" ? `.*${String(item.value)}.*` : String(item.value);
  return { labels: [`${label(item.field, config)}${op}${escape(value)}`], lines: [] };
}
export function compileLokiQuery(query: SemanticQuery, config: LokiAdapterConfig, context: CompileContext = {}): CompiledQuery<LokiCompiledRequest> {
  const validation = validateQuery(query); if (!validation.valid) fail("QUERY_VALIDATION_FAILED", "The semantic query is not valid.", "/spec");
  if (query.spec.input.signal !== "logs" || query.spec.input.entity !== LOKI_DATASET) fail("DATASET_NOT_FOUND", `Dataset '${query.spec.input.entity}' is not registered.`, "/spec/input/entity");
  if (!query.spec.timeRange) fail("TIME_RANGE_REQUIRED", "Loki range queries require a bounded time range.", "/spec/timeRange");
  if (query.spec.groupBy?.length || query.spec.joins?.length || query.spec.select.some((item) => !("field" in item))) fail("UNSUPPORTED_OPERATION", "Loki log listing supports projection and filtering; use native LogQL for metric expressions.", "/spec");
  const { startMs, endMs } = boundedEpochRange(query.spec.timeRange.from, query.spec.timeRange.to, config.maxTimeRangeMs);
  const maximum = Math.min(config.maxResultRows ?? 5_000, context.maxResultRows ?? Number.POSITIVE_INFINITY);
  const limit = query.spec.limit ?? Math.min(1_000, maximum); if (!Number.isInteger(limit) || limit < 1 || limit > maximum) fail("QUERY_LIMIT_EXCEEDED", `Loki limit exceeds ${maximum}.`, "/spec/limit");
  const compiled = clauses(query.spec.where, config);
  const logql = `{${compiled.labels.join(",")}}${compiled.lines.length ? ` ${compiled.lines.join(" ")}` : ""}`;
  return { kind: "CompiledQuery", language: "logql", compiled: { endpoint: "query_range", logql, startNs: String(Math.floor(startMs * 1_000_000)), endNs: String(Math.ceil(endMs * 1_000_000)), limit, direction: query.spec.orderBy?.[0]?.direction === "asc" ? "forward" : "backward" }, parameters: {}, fields: [{ name: "timestamp", type: "time", source: "timestamp" }, { name: "body", type: "string", source: "body" }, { name: "labels", type: "json", source: "labels" }], source: { resourceName: query.metadata.name, dataset: LOKI_DATASET }, warnings: [] };
}
