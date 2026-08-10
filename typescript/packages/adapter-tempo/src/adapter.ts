import type {
  NativeQuery,
  QueryResult,
  SemanticQuery,
  SemanticSchema,
} from "@openplait/core";
import {
  AdapterError,
  isAbortError,
  isCompiledQuery,
  type AdapterManifest,
  type AdapterValidationIssue,
  type AdapterValidationResult,
  type CompileContext,
  type CompiledQuery,
  type DatasourceAdapter,
  type DatasourceCapabilities,
  type DiscoveryContext,
  type ExecutionContext,
  type QueryExplanation,
} from "@openplait/adapter-sdk";

import { compileTempoQuery, tempoFieldRegistry } from "./compiler.js";
import { TEMPO_TRACE_FIELDS, tempoSemanticSchema } from "./datasets.js";
import { compileNativeTempoQuery } from "./native.js";
import {
  normalizeTempoSearchResponse,
  normalizeTempoMetricsResponse,
  normalizeTempoTraceResponse,
} from "./normalization.js";
import type {
  TempoAdapterConfig,
  TempoAdapterOptions,
  TempoCompiledRequest,
  TempoSearchResponse,
  TempoMetricsRange,
  TempoMetricsResponse,
  TempoServerCapabilities,
  TempoTraceRange,
  TempoTraceResponse,
} from "./types.js";

const ADAPTER_VERSION = "0.1.0-alpha.0";
const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_MAX_RESULT_ROWS = 1_000;
const SAFE_HEADER = /^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/;
const SAFE_REQUEST_ID = /^[A-Za-z0-9_.:-]{1,128}$/;
const SAFE_CANONICAL_FIELD = /^[A-Za-z_][A-Za-z0-9_.-]*$/;

interface TempoBuildInfo {
  version?: unknown;
}

function parsedVersion(version: string | undefined): { major: number; minor: number } | undefined {
  const match = version?.trim().replace(/^v/i, "").match(/^(\d+)\.(\d+)/);
  return match ? { major: Number(match[1]), minor: Number(match[2]) } : undefined;
}

function versionAtLeast(version: string | undefined, major: number, minor: number): boolean | null {
  const parsed = parsedVersion(version);
  if (!parsed) return null;
  return parsed.major > major || (parsed.major === major && parsed.minor >= minor);
}

export function tempoCapabilitiesForConfig(config: TempoAdapterConfig): TempoServerCapabilities {
  const version = config.tempoVersion?.trim() || undefined;
  return {
    ...(version ? { version } : {}),
    features: {
      traceql: versionAtLeast(version, 2, 0),
      mostRecent: config.enableMostRecent ?? versionAtLeast(version, 2, 8),
      // Metrics existed experimentally in Tempo 2.x and are GA in Tempo 3.0.
      // Unknown is more honest than promising an endpoint that may be disabled.
      traceqlMetrics: config.enableTraceqlMetrics ?? (versionAtLeast(version, 3, 0) === true ? true : null),
      tagSearchV2: config.enableTagSearchV2 ?? versionAtLeast(version, 2, 3),
    },
    limits: {
      ...(config.maxResultRows === undefined ? {} : { maxResultRows: config.maxResultRows }),
      ...(config.maxTimeRangeMs === undefined ? {} : { maxTimeRangeMs: config.maxTimeRangeMs }),
      ...(config.maxSpansPerSpanSet === undefined ? {} : { maxSpansPerSpanSet: config.maxSpansPerSpanSet }),
    },
  };
}

export const TEMPO_ADAPTER_MANIFEST: AdapterManifest = {
  name: "tempo",
  displayName: "Grafana Tempo",
  version: ADAPTER_VERSION,
  queryLanguages: ["openplait-semantic", "traceql"],
  signals: ["traces"],
};

export const TEMPO_CAPABILITIES: DatasourceCapabilities = {
  signals: ["traces"],
  operations: ["select", "filter", "order", "limit"],
  joins: { local: false, crossDatasource: false },
  nativeQueryLanguages: ["traceql"],
  explain: true,
  schemaDiscovery: true,
};

function positiveIntegerIssue(value: number | undefined, path: string): AdapterValidationIssue | undefined {
  if (value === undefined || (Number.isInteger(value) && value > 0)) return undefined;
  return { code: "CONFIG_INVALID", path, message: "Value must be a positive integer." };
}

export function validateTempoConfig(
  config: TempoAdapterConfig,
): AdapterValidationResult<TempoAdapterConfig> {
  const errors: AdapterValidationIssue[] = [];
  try {
    const url = new URL(config.url);
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      errors.push({ code: "CONFIG_INVALID", path: "/url", message: "Tempo URL must use http or https." });
    }
    if (url.search || url.hash) {
      errors.push({ code: "CONFIG_INVALID", path: "/url", message: "Tempo URL cannot contain a query string or fragment." });
    }
  } catch {
    errors.push({ code: "CONFIG_INVALID", path: "/url", message: "Tempo URL is invalid." });
  }
  for (const issue of [
    positiveIntegerIssue(config.requestTimeoutMs, "/requestTimeoutMs"),
    positiveIntegerIssue(config.queryTimeoutMs, "/queryTimeoutMs"),
    positiveIntegerIssue(config.maxResultRows, "/maxResultRows"),
    positiveIntegerIssue(config.maxSpansPerSpanSet, "/maxSpansPerSpanSet"),
    positiveIntegerIssue(config.maxTimeRangeMs, "/maxTimeRangeMs"),
  ]) {
    if (issue) errors.push(issue);
  }
  if (config.tempoVersion !== undefined && !/^v?\d+\.\d+(?:\.\d+)?(?:[-+].*)?$/.test(config.tempoVersion.trim())) {
    errors.push({ code: "CONFIG_INVALID", path: "/tempoVersion", message: "Tempo version must be a semantic version such as 2.8.0." });
  }
  if ((config.username === undefined) !== (config.password === undefined)) {
    errors.push({ code: "CONFIG_INVALID", path: "/username", message: "Tempo basic auth requires both username and password." });
  }
  if (config.bearerToken !== undefined && config.username !== undefined) {
    errors.push({ code: "CONFIG_INVALID", path: "/bearerToken", message: "Bearer and basic authentication cannot be configured together." });
  }
  for (const [name, value] of Object.entries(config.httpHeaders ?? {})) {
    if (!SAFE_HEADER.test(name) || /[\r\n]/.test(value)) {
      errors.push({ code: "CONFIG_INVALID", path: `/httpHeaders/${name}`, message: "Tempo header names and values must be valid HTTP headers." });
    }
  }
  for (const [name, mapping] of Object.entries(config.attributeFields ?? {})) {
    if (!SAFE_CANONICAL_FIELD.test(name)) {
      errors.push({ code: "CONFIG_INVALID", path: `/attributeFields/${name}`, message: "Canonical field names must be safe dot-separated identifiers." });
    }
    if (name in TEMPO_TRACE_FIELDS) {
      errors.push({ code: "CONFIG_INVALID", path: `/attributeFields/${name}`, message: "Configured attribute fields cannot replace built-in Tempo fields." });
    }
    if (!/^[A-Za-z_][A-Za-z0-9_.\/-]*$/.test(mapping.attribute)) {
      errors.push({ code: "CONFIG_INVALID", path: `/attributeFields/${name}/attribute`, message: "Tempo attribute names contain invalid characters." });
    }
    if (!["resource", "span", "event", "link"].includes(mapping.scope)) {
      errors.push({ code: "CONFIG_INVALID", path: `/attributeFields/${name}/scope`, message: "Tempo attribute scope is invalid." });
    }
    if (mapping.type !== undefined && !["string", "number", "boolean"].includes(mapping.type)) {
      errors.push({ code: "CONFIG_INVALID", path: `/attributeFields/${name}/type`, message: "Tempo attribute fields support string, number, or boolean values." });
    }
  }
  return errors.length ? { valid: false, errors } : { valid: true, value: config, errors: [] };
}

interface AbortScope {
  signal: AbortSignal;
  timedOut: () => boolean;
  dispose: () => void;
}

function abortScope(external: AbortSignal | undefined, timeoutMs: number): AbortScope {
  const controller = new AbortController();
  let didTimeOut = false;
  const onAbort = (): void => controller.abort(external?.reason);
  if (external?.aborted) onAbort();
  else external?.addEventListener("abort", onAbort, { once: true });
  const timeout = setTimeout(() => {
    didTimeOut = true;
    controller.abort(new DOMException("Tempo request timed out.", "TimeoutError"));
  }, timeoutMs);
  return {
    signal: controller.signal,
    timedOut: () => didTimeOut,
    dispose: () => {
      clearTimeout(timeout);
      external?.removeEventListener("abort", onAbort);
    },
  };
}

function deepFreeze<T>(value: T): T {
  if (typeof value !== "object" || value === null || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}

function rangeSeconds(range: TempoTraceRange): { start: number; end: number } {
  const parse = (value: string | number): number => typeof value === "number" ? value : Date.parse(value);
  const from = parse(range.from);
  const to = parse(range.to);
  if (!Number.isFinite(from) || !Number.isFinite(to) || to < from) {
    throw new AdapterError("INVALID_PARAMETER", "Tempo trace range is invalid.", { path: "/range" });
  }
  return { start: Math.floor(from / 1_000), end: Math.ceil(to / 1_000) };
}

export class TempoAdapter implements DatasourceAdapter<TempoAdapterConfig, TempoCompiledRequest> {
  readonly manifest = TEMPO_ADAPTER_MANIFEST;
  private readonly config: TempoAdapterConfig;
  private readonly fetchImplementation: typeof fetch;
  private readonly now: () => number;
  private readonly compiledQueries = new WeakSet<object>();

  constructor(config: TempoAdapterConfig, options: TempoAdapterOptions = {}) {
    const validation = validateTempoConfig(config);
    if (!validation.valid) {
      throw new AdapterError("CONFIG_INVALID", "Tempo adapter config is invalid.", {
        details: { errors: validation.errors },
      });
    }
    this.config = structuredClone(config);
    this.fetchImplementation = options.fetch ?? globalThis.fetch;
    this.now = options.now ?? Date.now;
  }

  validateConfig(config: TempoAdapterConfig): AdapterValidationResult<TempoAdapterConfig> {
    return validateTempoConfig(config);
  }

  async getCapabilities(config: TempoAdapterConfig): Promise<DatasourceCapabilities> {
    const validation = validateTempoConfig(config);
    if (!validation.valid) {
      throw new AdapterError("CONFIG_INVALID", "Tempo adapter config is invalid.", { details: { errors: validation.errors } });
    }
    const tempo = tempoCapabilitiesForConfig(config);
    return {
      ...TEMPO_CAPABILITIES,
      nativeQueryLanguages: config.allowNativeQueries ? ["traceql"] : [],
      limits: {
        ...(config.maxResultRows === undefined ? {} : { maxResultRows: config.maxResultRows }),
        ...(config.maxTimeRangeMs === undefined ? {} : { maxTimeRangeMs: config.maxTimeRangeMs }),
      },
      extensions: { "io.openplait.tempo": tempo },
    };
  }

  /** Resolve version-sensitive Tempo features without running a trace search. */
  async inspectServer(context: DiscoveryContext = {}): Promise<TempoServerCapabilities> {
    const response = await this.requestJson<TempoBuildInfo>(
      this.url("api/status/buildinfo"),
      {
        signal: context.abortSignal,
        timeoutMs: context.timeoutMs ?? this.config.requestTimeoutMs ?? DEFAULT_TIMEOUT_MS,
      },
    );
    const version = typeof response.version === "string" ? response.version : undefined;
    return tempoCapabilitiesForConfig({ ...this.config, ...(version ? { tempoVersion: version } : {}) });
  }

  async compile(query: SemanticQuery, context: CompileContext): Promise<CompiledQuery<TempoCompiledRequest>> {
    const compiled = deepFreeze(compileTempoQuery(query, this.config, context));
    this.compiledQueries.add(compiled);
    return compiled;
  }

  private url(path: string, parameters: Record<string, string | number | undefined> = {}): URL {
    const base = this.config.url.endsWith("/") ? this.config.url : `${this.config.url}/`;
    const url = new URL(path.replace(/^\//, ""), base);
    for (const [name, value] of Object.entries(parameters)) {
      if (value !== undefined) url.searchParams.set(name, String(value));
    }
    return url;
  }

  private headers(requestId?: string): Headers {
    const headers = new Headers(this.config.httpHeaders);
    headers.set("Accept", "application/json");
    if (this.config.tenantId) headers.set("X-Scope-OrgID", this.config.tenantId);
    if (this.config.bearerToken) headers.set("Authorization", `Bearer ${this.config.bearerToken}`);
    if (this.config.username !== undefined && this.config.password !== undefined) {
      headers.set("Authorization", `Basic ${Buffer.from(`${this.config.username}:${this.config.password}`).toString("base64")}`);
    }
    if (requestId) headers.set("X-Request-ID", requestId);
    return headers;
  }

  private async requestJson<T>(
    url: URL,
    options: {
      signal: AbortSignal | undefined;
      timeoutMs: number;
      requestId?: string;
    },
  ): Promise<T> {
    const scope = abortScope(options.signal, options.timeoutMs);
    try {
      const response = await this.fetchImplementation(url, {
        method: "GET",
        headers: this.headers(options.requestId),
        signal: scope.signal,
      });
      if (!response.ok) {
        const body = (await response.text()).slice(0, 2_000);
        throw new AdapterError("EXECUTION_FAILED", `Tempo returned HTTP ${response.status}.`, {
          details: {
            status: response.status,
            statusText: response.statusText,
            body,
            endpoint: url.pathname,
            queryParameterNames: Array.from(url.searchParams.keys()).sort(),
            queryLength: url.searchParams.get("q")?.length ?? 0,
            ...(options.requestId ? { requestId: options.requestId } : {}),
            ...(response.headers.get("x-request-id") ? { upstreamRequestId: response.headers.get("x-request-id") } : {}),
          },
        });
      }
      return await response.json() as T;
    } catch (error) {
      if (scope.timedOut()) {
        throw new AdapterError("TIMEOUT", `Tempo request exceeded ${options.timeoutMs}ms.`, {
          cause: error,
          details: { timeoutMs: options.timeoutMs },
        });
      }
      if (options.signal?.aborted || isAbortError(error)) {
        throw new AdapterError("ABORTED", "Tempo request was cancelled.", { cause: error });
      }
      if (error instanceof AdapterError) throw error;
      throw new AdapterError("EXECUTION_FAILED", "Tempo request failed.", { cause: error });
    } finally {
      scope.dispose();
    }
  }

  private executionRequestId(context: ExecutionContext): string {
    const requestId = context.queryId ?? context.audit?.requestId;
    if (!requestId || !SAFE_REQUEST_ID.test(requestId)) {
      throw new AdapterError("QUERY_VALIDATION_FAILED", "Execution requires a safe audit request ID or query ID.", {
        path: "/execution/audit/requestId",
      });
    }
    return requestId;
  }

  async execute(
    query: CompiledQuery<TempoCompiledRequest> | NativeQuery,
    context: ExecutionContext,
  ): Promise<QueryResult> {
    let request: TempoCompiledRequest;
    let fields: CompiledQuery<TempoCompiledRequest>["fields"] | undefined;
    let frameName: string;
    if (isCompiledQuery<TempoCompiledRequest>(query)) {
      if (!this.compiledQueries.has(query)) {
        throw new AdapterError("QUERY_VALIDATION_FAILED", "Compiled query was not produced by this adapter instance.");
      }
      request = query.compiled;
      fields = query.fields;
      frameName = query.source.resourceName;
    } else {
      if (!this.config.allowNativeQueries) {
        throw new AdapterError("NATIVE_QUERY_REJECTED", "Native TraceQL is disabled for this Tempo datasource.", { path: "/spec/native" });
      }
      request = compileNativeTempoQuery(query, this.config, context.variables);
      frameName = query.metadata.name;
    }
    const timeoutMs = Math.min(
      context.timeoutMs ?? this.config.queryTimeoutMs ?? DEFAULT_TIMEOUT_MS,
      this.config.queryTimeoutMs ?? DEFAULT_TIMEOUT_MS,
    );
    const started = this.now();
    const response = await this.requestJson<TempoSearchResponse>(
      this.url("api/search", {
        q: request.traceql,
        start: request.start,
        end: request.end,
        limit: request.limit,
        spss: request.spansPerSpanSet,
      }),
      { signal: context.abortSignal, timeoutMs, requestId: this.executionRequestId(context) },
    );
    return normalizeTempoSearchResponse(response, {
      frameName,
      adapterVersion: ADAPTER_VERSION,
      executionTimeMs: Math.max(0, this.now() - started),
      ...(fields === undefined ? {} : { fields }),
    });
  }

  async explain(
    query: SemanticQuery,
    context: CompileContext,
  ): Promise<QueryExplanation<TempoCompiledRequest>> {
    const compiledQuery = await this.compile(query, context);
    return {
      summary: `Compile '${query.metadata.name}' to a bounded Tempo TraceQL search.`,
      steps: [
        `Resolve logical dataset '${query.spec.input.entity}'.`,
        "Map canonical fields to allowlisted TraceQL intrinsics and attributes.",
        "Encode filter values as type-aware TraceQL literals.",
        "Apply bounded time, result, and spans-per-span-set limits.",
      ],
      compiledQuery,
      warnings: compiledQuery.warnings,
    };
  }

  async discoverSchema(_context: DiscoveryContext): Promise<SemanticSchema> {
    const schema = tempoSemanticSchema();
    const dataset = schema.datasets[0];
    const extension = dataset?.extensions?.["io.openplait.tempo"];
    if (dataset && typeof extension === "object" && extension !== null) {
      dataset.extensions = {
        ...dataset.extensions,
        "io.openplait.tempo": {
          ...extension,
          configuredAttributeFields: Object.keys(this.config.attributeFields ?? {}),
        },
      };
    }
    return schema;
  }

  /** Fetch and normalize a complete OTLP trace into one dataframe row per span. */
  async getTrace(
    traceId: string,
    context: ExecutionContext,
    range?: TempoTraceRange,
  ): Promise<QueryResult> {
    if (!/^[A-Fa-f0-9]{16,32}$/.test(traceId)) {
      throw new AdapterError("INVALID_PARAMETER", "Trace IDs must contain 16 to 32 hexadecimal characters.", { path: "/traceId" });
    }
    const timeoutMs = Math.min(context.timeoutMs ?? this.config.queryTimeoutMs ?? DEFAULT_TIMEOUT_MS, this.config.queryTimeoutMs ?? DEFAULT_TIMEOUT_MS);
    const started = this.now();
    const seconds = range ? rangeSeconds(range) : undefined;
    const response = await this.requestJson<TempoTraceResponse>(
      this.url(`api/traces/${encodeURIComponent(traceId)}`, seconds),
      { signal: context.abortSignal, timeoutMs, requestId: this.executionRequestId(context) },
    );
    return normalizeTempoTraceResponse(response, {
      frameName: traceId,
      adapterVersion: ADAPTER_VERSION,
      executionTimeMs: Math.max(0, this.now() - started),
    });
  }

  /** Execute a bounded TraceQL metrics range query and normalize its samples. */
  async queryMetrics(
    range: TempoMetricsRange,
    context: ExecutionContext,
  ): Promise<QueryResult> {
    if (!range.query.trim() || range.query.length > 32_768 || /\0/.test(range.query)) {
      throw new AdapterError("INVALID_PARAMETER", "Tempo metrics query is invalid.", { path: "/query" });
    }
    if (!/^\d+(?:\.\d+)?(?:ms|s|m|h)$/.test(range.step)) {
      throw new AdapterError("INVALID_PARAMETER", "Tempo metrics step must be a positive Go duration.", { path: "/step" });
    }
    if (range.exemplars !== undefined && (!Number.isInteger(range.exemplars) || range.exemplars < 0)) {
      throw new AdapterError("INVALID_PARAMETER", "Tempo metrics exemplars must be a non-negative integer.", { path: "/exemplars" });
    }
    const seconds = rangeSeconds(range);
    const timeoutMs = Math.min(
      context.timeoutMs ?? this.config.queryTimeoutMs ?? DEFAULT_TIMEOUT_MS,
      this.config.queryTimeoutMs ?? DEFAULT_TIMEOUT_MS,
    );
    const started = this.now();
    const response = await this.requestJson<TempoMetricsResponse>(
      this.url("api/metrics/query_range", {
        q: range.query,
        start: seconds.start,
        end: seconds.end,
        step: range.step,
        exemplars: range.exemplars,
      }),
      { signal: context.abortSignal, timeoutMs, requestId: this.executionRequestId(context) },
    );
    return normalizeTempoMetricsResponse(response, {
      frameName: "tempo-metrics",
      adapterVersion: ADAPTER_VERSION,
      executionTimeMs: Math.max(0, this.now() - started),
    });
  }

  /** Discover Tempo tag names using the v2 search API. */
  async discoverTags(
    scope: "resource" | "span" | "intrinsic" | "event" | "link" | "instrumentation",
    context: DiscoveryContext,
  ): Promise<string[]> {
    const request = (path: string, parameters: Record<string, string | number | undefined>) => this.requestJson<Record<string, unknown>>(
      this.url(path, parameters),
      { signal: context.abortSignal, timeoutMs: context.timeoutMs ?? this.config.requestTimeoutMs ?? DEFAULT_TIMEOUT_MS },
    );
    let response: Record<string, unknown>;
    if (this.config.enableTagSearchV2 === false) {
      response = await request("api/search/tags", {});
    } else {
      try {
        response = await request("api/v2/search/tags", { scope });
      } catch (error) {
        const status = error instanceof AdapterError ? error.details?.status : undefined;
        if (this.config.enableTagSearchV2 === true || (status !== 400 && status !== 404)) throw error;
        response = await request("api/search/tags", {});
      }
    }
    const values = response.tagNames ?? response.tags;
    if (Array.isArray(values)) {
      return values.filter((value): value is string => typeof value === "string");
    }
    if (!Array.isArray(response.scopes)) return [];
    return response.scopes.flatMap((item) => {
      if (typeof item !== "object" || item === null) return [];
      const tags = (item as { tags?: unknown }).tags;
      return Array.isArray(tags)
        ? tags.filter((value): value is string => typeof value === "string")
        : [];
    });
  }

  /** Discover values for a TraceQL intrinsic or attribute. */
  async discoverTagValues(
    tag: string,
    context: DiscoveryContext,
    options: { query?: string; range?: TempoTraceRange } = {},
  ): Promise<string[]> {
    if (!tag || /[\r\n\0]/.test(tag)) {
      throw new AdapterError("INVALID_PARAMETER", "Tempo tag name is invalid.", { path: "/tag" });
    }
    const seconds = options.range ? rangeSeconds(options.range) : undefined;
    const parameters = { q: options.query, start: seconds?.start, end: seconds?.end };
    const request = (path: string) => this.requestJson<Record<string, unknown>>(
      this.url(path, parameters),
      { signal: context.abortSignal, timeoutMs: context.timeoutMs ?? this.config.requestTimeoutMs ?? DEFAULT_TIMEOUT_MS },
    );
    let response: Record<string, unknown>;
    if (this.config.enableTagSearchV2 === false) {
      response = await request(`api/search/tag/${encodeURIComponent(tag)}/values`);
    } else {
      try {
        response = await request(`api/v2/search/tag/${encodeURIComponent(tag)}/values`);
      } catch (error) {
        const status = error instanceof AdapterError ? error.details?.status : undefined;
        if (this.config.enableTagSearchV2 === true || (status !== 400 && status !== 404)) throw error;
        response = await request(`api/search/tag/${encodeURIComponent(tag)}/values`);
      }
    }
    const values = response.tagValues ?? response.values;
    if (!Array.isArray(values)) return [];
    return values.flatMap((value) => {
      if (typeof value === "string") return [value];
      if (typeof value === "object" && value !== null && typeof (value as { value?: unknown }).value === "string") return [(value as { value: string }).value];
      return [];
    });
  }

  /** Exposes all built-in and configured semantic filter mappings. */
  getFieldMappings(): ReturnType<typeof tempoFieldRegistry> {
    return tempoFieldRegistry(this.config);
  }
}
