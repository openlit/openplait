import type { NativeQuery, QueryResult, SemanticQuery, SemanticSchema } from "@openplait/core";
import { AdapterError, datasourceUrl, deepFreeze, httpHeaders, isCompiledQuery, requestJson, requireSafeRequestId, validateHttpAdapterConfig, boundedEpochRange, type AdapterManifest, type AdapterValidationIssue, type AdapterValidationResult, type CompileContext, type CompiledQuery, type DatasourceAdapter, type DatasourceCapabilities, type DiscoveryContext, type ExecutionContext, type QueryExplanation } from "@openplait/adapter-sdk";
import { compilePrometheusQuery, parsePrometheusStep, PROMETHEUS_DATASET } from "./compiler.js";
import { normalizePrometheusResponse } from "./normalization.js";
import type { PrometheusAdapterConfig, PrometheusAdapterOptions, PrometheusApiResponse, PrometheusCompiledRequest, PrometheusNativeOptions } from "./types.js";

const VERSION = "0.1.0-alpha.0";
const DEFAULT_TIMEOUT = 30_000;
export const PROMETHEUS_ADAPTER_MANIFEST: AdapterManifest = { name: "prometheus", displayName: "Prometheus", version: VERSION, queryLanguages: ["openplait-semantic", "promql"], signals: ["metrics"] };
export const PROMETHEUS_CAPABILITIES: DatasourceCapabilities = { signals: ["metrics"], operations: ["select", "filter", "aggregate", "group", "limit", "rate", "timeBucket"], joins: { local: false, crossDatasource: false }, nativeQueryLanguages: ["promql"], explain: true, schemaDiscovery: true };

export function validatePrometheusConfig(config: PrometheusAdapterConfig): AdapterValidationResult<PrometheusAdapterConfig> {
  const errors: AdapterValidationIssue[] = validateHttpAdapterConfig(config);
  for (const [path, value] of [["/maxResultRows", config.maxResultRows], ["/maxSeries", config.maxSeries], ["/maxTimeRangeMs", config.maxTimeRangeMs], ["/maxLookbackMs", config.maxLookbackMs]] as const) {
    if (value !== undefined && (!Number.isInteger(value) || value <= 0)) errors.push({ code: "CONFIG_INVALID", path, message: "Value must be a positive integer." });
  }
  if (config.defaultStep !== undefined) try { parsePrometheusStep(config.defaultStep); } catch { errors.push({ code: "CONFIG_INVALID", path: "/defaultStep", message: "Step must be a duration such as 30s or 5m." }); }
  for (const [field, label] of Object.entries(config.labelFields ?? {})) if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(label)) errors.push({ code: "CONFIG_INVALID", path: `/labelFields/${field}`, message: "Prometheus label name is invalid." });
  return errors.length ? { valid: false, errors } : { valid: true, value: config, errors: [] };
}

export class PrometheusAdapter implements DatasourceAdapter<PrometheusAdapterConfig, PrometheusCompiledRequest> {
  readonly manifest = PROMETHEUS_ADAPTER_MANIFEST;
  private readonly config: PrometheusAdapterConfig;
  private readonly fetchImplementation: typeof fetch;
  private readonly now: () => number;
  private readonly compiled = new WeakSet<object>();
  constructor(config: PrometheusAdapterConfig, options: PrometheusAdapterOptions = {}) {
    const validation = validatePrometheusConfig(config);
    if (!validation.valid) throw new AdapterError("CONFIG_INVALID", "Prometheus adapter config is invalid.", { details: { errors: validation.errors } });
    this.config = { ...config, url: config.url.replace(/\/+$/, "") };
    this.fetchImplementation = options.fetch ?? fetch;
    this.now = options.now ?? Date.now;
  }
  validateConfig(config: PrometheusAdapterConfig) { return validatePrometheusConfig(config); }
  async getCapabilities(): Promise<DatasourceCapabilities> { return { ...PROMETHEUS_CAPABILITIES, limits: { ...(this.config.maxResultRows ? { maxResultRows: this.config.maxResultRows } : {}), ...(this.config.maxTimeRangeMs ? { maxTimeRangeMs: this.config.maxTimeRangeMs } : {}), ...(this.config.maxLookbackMs ? { maxLookbackMs: this.config.maxLookbackMs } : {}) } }; }
  async compile(query: SemanticQuery, context: CompileContext): Promise<CompiledQuery<PrometheusCompiledRequest>> { const result = deepFreeze(compilePrometheusQuery(query, this.config, context)); this.compiled.add(result); return result; }
  private native(query: NativeQuery): PrometheusCompiledRequest {
    if (query.spec.native.language.toLowerCase() !== "promql" || !query.spec.native.statement.trim() || /\0/.test(query.spec.native.statement)) throw new AdapterError("NATIVE_QUERY_REJECTED", "Native query must contain valid PromQL.");
    const extension = query.spec.extensions?.["io.openplait.prometheus"] as PrometheusNativeOptions | undefined;
    if (!extension?.timeRange) throw new AdapterError("TIME_RANGE_REQUIRED", "Native PromQL range queries require io.openplait.prometheus.timeRange.");
    const range = boundedEpochRange(extension.timeRange.from, extension.timeRange.to, this.config.maxTimeRangeMs);
    const step = extension.step ?? this.config.defaultStep ?? "30s"; parsePrometheusStep(step);
    return { endpoint: "query_range", promql: query.spec.native.statement, start: range.startMs / 1000, end: range.endMs / 1000, step };
  }
  async execute(query: CompiledQuery<PrometheusCompiledRequest> | NativeQuery, context: ExecutionContext): Promise<QueryResult> {
    let request: PrometheusCompiledRequest; let frameName: string;
    if (isCompiledQuery<PrometheusCompiledRequest>(query)) { if (!this.compiled.has(query)) throw new AdapterError("QUERY_VALIDATION_FAILED", "Compiled query was not produced by this adapter instance."); request = query.compiled; frameName = query.source.resourceName; }
    else { if (!this.config.allowNativeQueries) throw new AdapterError("NATIVE_QUERY_REJECTED", "Native PromQL is disabled for this datasource."); request = this.native(query); frameName = query.metadata.name; }
    const started = this.now();
    const response = await requestJson<PrometheusApiResponse>(datasourceUrl(this.config.url, "api/v1/query_range", { query: request.promql, start: request.start, end: request.end, step: request.step }), { fetch: this.fetchImplementation, datasourceName: "Prometheus", signal: context.abortSignal, timeoutMs: Math.min(context.timeoutMs ?? this.config.queryTimeoutMs ?? DEFAULT_TIMEOUT, this.config.queryTimeoutMs ?? DEFAULT_TIMEOUT), requestId: requireSafeRequestId(context.queryId ?? context.audit?.requestId), headers: httpHeaders(this.config) });
    return normalizePrometheusResponse(response, frameName, VERSION, Math.max(0, this.now() - started));
  }
  async explain(query: SemanticQuery, context: CompileContext): Promise<QueryExplanation<PrometheusCompiledRequest>> { const compiledQuery = await this.compile(query, context); return { summary: "Compile the semantic metric query to bounded PromQL.", steps: ["Map canonical fields to labels.", "Compile safe label matchers.", "Apply aggregation and a bounded range step."], compiledQuery, warnings: compiledQuery.warnings }; }
  async discoverSchema(_context: DiscoveryContext): Promise<SemanticSchema> { return { datasets: [{ name: PROMETHEUS_DATASET, signal: "metrics", fields: [{ name: "timestamp", type: "time", signals: ["metrics"] }, { name: "value", type: "number", signals: ["metrics"] }, { name: "metric.name", type: "string", signals: ["metrics"] }, { name: "labels", type: "json", signals: ["metrics"] }], supportedAggregations: ["sum", "avg", "min", "max", "count", "rate"] }] }; }
  private discoveryTimeParams(context: DiscoveryContext): Record<string, string | number | undefined> {
    if (!context.timeRange) return {};
    const startMs = new Date(context.timeRange.from).getTime();
    const endMs = new Date(context.timeRange.to).getTime();
    if (!Number.isFinite(startMs) || !Number.isFinite(endMs)) return {};
    return { start: Math.floor(startMs / 1000), end: Math.ceil(endMs / 1000) };
  }
  private async discovery(path: string, context: DiscoveryContext): Promise<string[]> { const response = await requestJson<{ status: string; data?: unknown }>(datasourceUrl(this.config.url, path, this.discoveryTimeParams(context)), { fetch: this.fetchImplementation, datasourceName: "Prometheus", signal: context.abortSignal, timeoutMs: context.timeoutMs ?? this.config.requestTimeoutMs ?? DEFAULT_TIMEOUT, headers: httpHeaders(this.config) }); return Array.isArray(response.data) ? response.data.filter((item): item is string => typeof item === "string") : []; }
  async labelNames(context: DiscoveryContext): Promise<string[]> { return this.discovery("api/v1/labels", context); }
  async labelValues(label: string, context: DiscoveryContext): Promise<string[]> { if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(label)) throw new AdapterError("INVALID_PARAMETER", "Prometheus label name is invalid."); return this.discovery(`api/v1/label/${encodeURIComponent(label)}/values`, context); }
  async metricNames(context: DiscoveryContext): Promise<string[]> { return this.labelValues("__name__", context); }
}
