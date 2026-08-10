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

import { compileJaegerQuery } from "./compiler.js";
import { JAEGER_DATASET_NAME, jaegerSemanticSchema } from "./datasets.js";
import {
  flattenJaegerTraces,
  normalizeJaegerSearchResponse,
  normalizeJaegerTraceResponse,
} from "./normalization.js";
import type {
  JaegerAdapterConfig,
  JaegerAdapterOptions,
  JaegerCompiledRequest,
  JaegerNormalizedSpan,
  JaegerSearchParams,
  JaegerServicesResponse,
  JaegerTrace,
  JaegerTracesResponse,
} from "./types.js";

const ADAPTER_VERSION = "0.1.0-alpha.0";
const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_MAX_RESULT_ROWS = 1_000;
const SAFE_HEADER = /^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/;
const SAFE_REQUEST_ID = /^[A-Za-z0-9_.:-]{1,128}$/;

export const JAEGER_ADAPTER_MANIFEST: AdapterManifest = {
  name: "jaeger",
  displayName: "Jaeger",
  version: ADAPTER_VERSION,
  queryLanguages: ["openplait-semantic"],
  signals: ["traces"],
};

export const JAEGER_CAPABILITIES: DatasourceCapabilities = {
  signals: ["traces"],
  operations: ["select", "filter", "order", "limit"],
  joins: { local: false, crossDatasource: false },
  nativeQueryLanguages: [],
  explain: true,
  schemaDiscovery: true,
};

function positiveIntegerIssue(
  value: number | undefined,
  path: string,
): AdapterValidationIssue | undefined {
  if (value === undefined || (Number.isInteger(value) && value > 0)) return undefined;
  return { code: "CONFIG_INVALID", path, message: "Value must be a positive integer." };
}

export function validateJaegerConfig(
  config: JaegerAdapterConfig,
): AdapterValidationResult<JaegerAdapterConfig> {
  const errors: AdapterValidationIssue[] = [];
  try {
    const url = new URL(config.url);
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      errors.push({
        code: "CONFIG_INVALID",
        path: "/url",
        message: "Jaeger URL must use http or https.",
      });
    }
    if (url.search || url.hash) {
      errors.push({
        code: "CONFIG_INVALID",
        path: "/url",
        message: "Jaeger URL cannot contain a query string or fragment.",
      });
    }
  } catch {
    errors.push({ code: "CONFIG_INVALID", path: "/url", message: "Jaeger URL is invalid." });
  }

  const hasUser = !!config.username?.trim();
  const hasPass = !!config.password;
  const hasBearer = !!config.bearerToken?.trim();
  if ((hasUser || hasPass) && hasBearer) {
    errors.push({
      code: "CONFIG_INVALID",
      path: "/bearerToken",
      message: "Use either basic auth or bearer token, not both.",
    });
  }
  if (hasUser !== hasPass) {
    errors.push({
      code: "CONFIG_INVALID",
      path: hasUser ? "/password" : "/username",
      message: "Basic auth requires both username and password.",
    });
  }

  for (const issue of [
    positiveIntegerIssue(config.requestTimeoutMs, "/requestTimeoutMs"),
    positiveIntegerIssue(config.maxResultRows, "/maxResultRows"),
    positiveIntegerIssue(config.maxTimeRangeMs, "/maxTimeRangeMs"),
    positiveIntegerIssue(config.perServiceLimit, "/perServiceLimit"),
  ]) {
    if (issue) errors.push(issue);
  }

  if (config.httpHeaders) {
    for (const [key, value] of Object.entries(config.httpHeaders)) {
      if (!SAFE_HEADER.test(key) || typeof value !== "string") {
        errors.push({
          code: "CONFIG_INVALID",
          path: `/httpHeaders/${key}`,
          message: "Header names must be valid HTTP tokens with string values.",
        });
      }
    }
  }

  return errors.length
    ? { valid: false, errors }
    : { valid: true, value: config, errors: [] };
}

export class JaegerAdapter implements DatasourceAdapter {
  readonly manifest = JAEGER_ADAPTER_MANIFEST;
  private apiBaseUrl: string;
  private readonly fetchImpl: typeof fetch;
  private readonly now: () => number;

  constructor(
    private readonly config: JaegerAdapterConfig,
    options: JaegerAdapterOptions = {},
  ) {
    const validation = validateJaegerConfig(config);
    if (!validation.valid) {
      throw new AdapterError("CONFIG_INVALID", validation.errors[0]?.message || "Invalid config", {
        details: { errors: validation.errors },
      });
    }
    this.apiBaseUrl = config.url.replace(/\/$/, "");
    this.fetchImpl = options.fetch ?? fetch;
    this.now = options.now ?? Date.now;
  }

  /** Effective Query API base after `/jaeger` path fallback (if any). */
  get resolvedUrl(): string {
    return this.apiBaseUrl;
  }

  validateConfig(config: JaegerAdapterConfig) {
    return validateJaegerConfig(config);
  }

  async getCapabilities(_config: JaegerAdapterConfig): Promise<DatasourceCapabilities> {
    return {
      ...JAEGER_CAPABILITIES,
      limits: {
        ...(this.config.maxResultRows === undefined
          ? {}
          : { maxResultRows: this.config.maxResultRows }),
        ...(this.config.maxTimeRangeMs === undefined
          ? {}
          : { maxTimeRangeMs: this.config.maxTimeRangeMs }),
      },
    };
  }

  async discoverSchema(_context?: DiscoveryContext): Promise<SemanticSchema> {
    return jaegerSemanticSchema();
  }

  async compile(
    query: SemanticQuery | NativeQuery,
    context: CompileContext = {},
  ): Promise<CompiledQuery<JaegerCompiledRequest>> {
    if (query.spec.mode === "native") {
      throw new AdapterError(
        "UNSUPPORTED_OPERATION",
        "Jaeger does not support native query languages; use semantic mode with service.name.",
      );
    }
    return compileJaegerQuery(query as SemanticQuery, {
      ...(context.variables ? { variables: context.variables } : {}),
      maxResultRows: context.maxResultRows ?? this.config.maxResultRows ?? DEFAULT_MAX_RESULT_ROWS,
    });
  }

  async execute(
    query: CompiledQuery<JaegerCompiledRequest> | NativeQuery,
    context: ExecutionContext,
  ): Promise<QueryResult> {
    if (!isCompiledQuery(query)) {
      throw new AdapterError(
        "UNSUPPORTED_OPERATION",
        "Jaeger execute expects a compiled semantic query.",
      );
    }
    const traces = await this.searchTraces({
      service: query.compiled.service,
      startMs: query.compiled.startMs,
      endMs: query.compiled.endMs,
      limit: query.compiled.limit,
      ...(query.compiled.operation ? { operation: query.compiled.operation } : {}),
      ...(query.compiled.tags ? { tags: query.compiled.tags } : {}),
    }, context);
    return normalizeJaegerSearchResponse(traces, query.fields);
  }

  async explain(
    query: SemanticQuery | NativeQuery,
    context: CompileContext = {},
  ): Promise<QueryExplanation<JaegerCompiledRequest>> {
    if (query.spec.mode === "native") {
      return {
        summary: "Native Jaeger queries are not supported.",
        steps: [],
        warnings: ["Jaeger has no native query language in OpenPlait."],
      };
    }
    const compiledQuery = await this.compile(query, context);
    return {
      summary: `Jaeger /api/traces search for service=${compiledQuery.compiled.service}`,
      steps: [
        `Resolve dataset '${compiledQuery.source.dataset}'.`,
        `GET /api/traces?service=${compiledQuery.compiled.service}&limit=${compiledQuery.compiled.limit}`,
      ],
      compiledQuery,
      warnings: compiledQuery.warnings,
    };
  }

  /** Discover services (or return configured list). Retries under `/jaeger` when needed. */
  async listServices(): Promise<string[]> {
    if (this.config.services?.length) return [...this.config.services];
    try {
      const response = await this.requestJson<JaegerServicesResponse>("/api/services");
      return (response.data || []).map(String).filter(Boolean);
    } catch (error) {
      if (new URL(this.apiBaseUrl).pathname === "/") {
        this.apiBaseUrl = `${this.apiBaseUrl}/jaeger`;
        const response = await this.requestJson<JaegerServicesResponse>("/api/services");
        return (response.data || []).map(String).filter(Boolean);
      }
      throw error;
    }
  }

  /** GET /api/services/{service}/operations — Jaeger Search operation dropdown. */
  async listOperations(service: string): Promise<string[]> {
    const name = encodeURIComponent(service.trim());
    if (!name) return [];
    const response = await this.requestJson<JaegerServicesResponse>(
      `/api/services/${name}/operations`,
    );
    return (response.data || []).map(String).filter(Boolean);
  }

  async searchTraces(
    params: JaegerSearchParams,
    context?: ExecutionContext,
  ): Promise<JaegerTrace[]> {
    const url = new URL(`${this.apiBaseUrl}/api/traces`);
    url.searchParams.set("service", params.service);
    url.searchParams.set("start", String(params.startMs * 1000));
    url.searchParams.set("end", String(params.endMs * 1000));
    url.searchParams.set(
      "limit",
      String(params.limit ?? this.config.perServiceLimit ?? 100),
    );
    if (params.operation) url.searchParams.set("operation", params.operation);
    if (params.tags && Object.keys(params.tags).length) {
      url.searchParams.set("tags", JSON.stringify(params.tags));
    }
    const response = await this.requestJson<JaegerTracesResponse>(
      url.toString(),
      context,
    );
    return response.data || [];
  }

  async getTrace(traceId: string, context?: ExecutionContext): Promise<JaegerTrace | null> {
    const id = encodeURIComponent(traceId.trim());
    if (!id) return null;
    const response = await this.requestJson<JaegerTracesResponse>(
      `/api/traces/${id}`,
      context,
    );
    return response.data?.[0] || null;
  }

  /** Convenience: normalize a list of Jaeger traces into OpenLIT-style spans. */
  normalizeSpans(traces: JaegerTrace[]): JaegerNormalizedSpan[] {
    return flattenJaegerTraces(traces);
  }

  async getTraceResult(traceId: string, context?: ExecutionContext): Promise<QueryResult | null> {
    const trace = await this.getTrace(traceId, context);
    return trace ? normalizeJaegerTraceResponse(trace) : null;
  }

  private authHeaders(): Record<string, string> {
    const headers: Record<string, string> = {
      Accept: "application/json",
      ...(this.config.httpHeaders || {}),
    };
    if (this.config.bearerToken) {
      headers.Authorization = `Bearer ${this.config.bearerToken}`;
    } else if (this.config.username && this.config.password) {
      const token = Buffer.from(
        `${this.config.username}:${this.config.password}`,
        "utf8",
      ).toString("base64");
      headers.Authorization = `Basic ${token}`;
    }
    return headers;
  }

  private async requestJson<T>(
    pathOrUrl: string,
    context?: ExecutionContext,
  ): Promise<T> {
    const requestId = context?.audit.requestId;
    if (requestId && !SAFE_REQUEST_ID.test(requestId)) {
      throw new AdapterError("CONFIG_INVALID", "Invalid request id.");
    }
    const url = pathOrUrl.startsWith("http")
      ? pathOrUrl
      : `${this.apiBaseUrl}${pathOrUrl.startsWith("/") ? "" : "/"}${pathOrUrl}`;
    const controller = new AbortController();
    const timeout = setTimeout(
      () => controller.abort(),
      this.config.requestTimeoutMs || DEFAULT_TIMEOUT_MS,
    );
    if (context?.abortSignal) {
      if (context.abortSignal.aborted) controller.abort();
      else context.abortSignal.addEventListener("abort", () => controller.abort(), { once: true });
    }
    try {
      const response = await this.fetchImpl(url, {
        method: "GET",
        headers: {
          ...this.authHeaders(),
          ...(requestId ? { "X-Request-Id": requestId } : {}),
        },
        signal: controller.signal,
      });
      const bodyText = await response.text();
      if (!response.ok) {
        throw new AdapterError("EXECUTION_FAILED", `Jaeger request failed (${response.status})`, {
          details: {
            status: response.status,
            body: bodyText.slice(0, 1000),
            endpoint: url,
          },
        });
      }
      if (!bodyText) return {} as T;
      try {
        return JSON.parse(bodyText) as T;
      } catch {
        throw new AdapterError("EXECUTION_FAILED", "Jaeger returned non-JSON body", {
          details: {
            endpoint: url,
            body: bodyText.slice(0, 500),
          },
        });
      }
    } catch (error) {
      if (isAbortError(error)) {
        throw new AdapterError("TIMEOUT", "Jaeger request timed out or was cancelled.");
      }
      if (error instanceof AdapterError) throw error;
      throw new AdapterError("EXECUTION_FAILED", String((error as Error)?.message || error));
    } finally {
      clearTimeout(timeout);
    }
  }
}
