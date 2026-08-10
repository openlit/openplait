import {
  createClient,
  type ClickHouseClient,
  type ClickHouseSettings,
  type ResponseJSON,
} from "@clickhouse/client";
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

import { compileClickHouseQuery } from "./compiler.js";
import { createDatasetRegistry, datasetsToSemanticSchema } from "./datasets.js";
import { compileNativeQuery } from "./native.js";
import {
  normalizeClickHouseResponse,
  type ClickHouseResponse,
} from "./normalization.js";
import type {
  ClickHouseAdapterConfig,
  ClickHouseAdapterOptions,
  ClickHouseCompiledStatement,
  ClickHouseDataset,
  ClickHouseRow,
} from "./types.js";

const ADAPTER_VERSION = "0.1.0-alpha.0";
const DEFAULT_QUERY_TIMEOUT_MS = 30_000;
const DEFAULT_MAX_RESULT_ROWS = 10_000;
const DEFAULT_MAX_ROWS_TO_READ = 10_000_000;
const SAFE_QUERY_ID = /^[A-Za-z0-9_.:-]{1,128}$/;
const SAFE_DATASET_NAME = /^[a-z][a-z0-9]*(?:\.[a-z0-9_]+)+$/;
const SAFE_TABLE_NAME = /^[A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z_][A-Za-z0-9_]*)?$/;
const UNSAFE_MAPPING_EXPRESSION = /;|--|\/\*|\*\/|\0/;

export const CLICKHOUSE_ADAPTER_MANIFEST: AdapterManifest = {
  name: "clickhouse",
  displayName: "ClickHouse",
  version: ADAPTER_VERSION,
  queryLanguages: ["openplait-semantic", "sql"],
  signals: ["traces", "logs", "metrics", "tabular"],
};

export const CLICKHOUSE_CAPABILITIES: DatasourceCapabilities = {
  signals: ["traces", "logs", "metrics", "tabular"],
  operations: [
    "select",
    "filter",
    "aggregate",
    "group",
    "order",
    "limit",
    "timeBucket",
    "rate",
    "percentile",
    "distinctCount",
    "histogram",
    "arithmetic",
  ],
  joins: { local: false, crossDatasource: false },
  nativeQueryLanguages: ["sql"],
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

function validateDataset(
  dataset: ClickHouseDataset,
  index: number,
): AdapterValidationIssue[] {
  const path = `/datasets/${index}`;
  const issues: AdapterValidationIssue[] = [];
  if (!SAFE_DATASET_NAME.test(dataset.name)) {
    issues.push({
      code: "CONFIG_INVALID",
      path: `${path}/name`,
      message: "Dataset names must be dot-separated lowercase identifiers.",
    });
  }
  if (!SAFE_TABLE_NAME.test(dataset.table)) {
    issues.push({
      code: "CONFIG_INVALID",
      path: `${path}/table`,
      message: "Dataset table must be an allowlisted ClickHouse identifier.",
    });
  }
  if (!(dataset.timeField in dataset.fields)) {
    issues.push({
      code: "CONFIG_INVALID",
      path: `${path}/timeField`,
      message: "Dataset timeField must reference one of its fields.",
    });
  }
  if (dataset.arrayJoin && !/^[A-Za-z_][A-Za-z0-9_]*$/.test(dataset.arrayJoin)) {
    issues.push({
      code: "CONFIG_INVALID",
      path: `${path}/arrayJoin`,
      message: "Dataset arrayJoin must be a single ClickHouse identifier.",
    });
  }
  for (const [field, mapping] of Object.entries(dataset.fields)) {
    if (!field || !mapping.expression || UNSAFE_MAPPING_EXPRESSION.test(mapping.expression)) {
      issues.push({
        code: "CONFIG_INVALID",
        path: `${path}/fields/${field}/expression`,
        message: "Field mapping expressions cannot be empty or contain statement/comment delimiters.",
      });
    }
  }
  return issues;
}

export function validateClickHouseConfig(
  config: ClickHouseAdapterConfig,
): AdapterValidationResult<ClickHouseAdapterConfig> {
  const errors: AdapterValidationIssue[] = [];
  try {
    const url = new URL(config.url);
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      errors.push({
        code: "CONFIG_INVALID",
        path: "/url",
        message: "ClickHouse URL must use http or https.",
      });
    }
  } catch {
    errors.push({
      code: "CONFIG_INVALID",
      path: "/url",
      message: "ClickHouse URL is invalid.",
    });
  }

  for (const issue of [
    positiveIntegerIssue(config.requestTimeoutMs, "/requestTimeoutMs"),
    positiveIntegerIssue(config.queryTimeoutMs, "/queryTimeoutMs"),
    positiveIntegerIssue(config.maxResultRows, "/maxResultRows"),
    positiveIntegerIssue(config.maxRowsToRead, "/maxRowsToRead"),
    positiveIntegerIssue(config.maxTimeRangeMs, "/maxTimeRangeMs"),
  ]) {
    if (issue) errors.push(issue);
  }
  for (const [index, dataset] of (config.datasets ?? []).entries()) {
    errors.push(...validateDataset(dataset, index));
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
    controller.abort(new DOMException("Query timed out.", "TimeoutError"));
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

function queryId(context: ExecutionContext): string {
  const id = context.queryId ?? context.audit?.requestId;
  if (!id || !SAFE_QUERY_ID.test(id)) {
    throw new AdapterError(
      "QUERY_VALIDATION_FAILED",
      "Execution requires a safe audit request ID or query ID.",
      { path: "/execution/audit/requestId" },
    );
  }
  return id;
}

function deepFreeze<T>(value: T): T {
  if (typeof value !== "object" || value === null || Object.isFrozen(value)) {
    return value;
  }
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}

export class ClickHouseAdapter
  implements DatasourceAdapter<ClickHouseAdapterConfig, ClickHouseCompiledStatement>
{
  readonly manifest = CLICKHOUSE_ADAPTER_MANIFEST;
  private readonly config: ClickHouseAdapterConfig;
  private readonly client: ClickHouseClient;
  private readonly ownsClient: boolean;
  private readonly now: () => number;
  private readonly compiledQueries = new WeakSet<object>();

  constructor(config: ClickHouseAdapterConfig, options: ClickHouseAdapterOptions = {}) {
    const validation = validateClickHouseConfig(config);
    if (!validation.valid) {
      throw new AdapterError("CONFIG_INVALID", "ClickHouse adapter config is invalid.", {
        details: { errors: validation.errors },
      });
    }
    this.config = structuredClone(config);
    this.client =
      options.client ??
      createClient({
        url: this.config.url,
        ...(this.config.username === undefined
          ? {}
          : { username: this.config.username }),
        ...(this.config.password === undefined
          ? {}
          : { password: this.config.password }),
        ...(this.config.database === undefined
          ? {}
          : { database: this.config.database }),
        ...(this.config.httpHeaders === undefined
          ? {}
          : { http_headers: this.config.httpHeaders }),
        application: this.config.applicationName ?? "openplait",
        request_timeout: this.config.requestTimeoutMs ?? DEFAULT_QUERY_TIMEOUT_MS,
        use_multipart_params_auto: true,
      });
    this.ownsClient = options.client === undefined;
    this.now = options.now ?? Date.now;
  }

  validateConfig(
    config: ClickHouseAdapterConfig,
  ): AdapterValidationResult<ClickHouseAdapterConfig> {
    return validateClickHouseConfig(config);
  }

  async getCapabilities(
    config: ClickHouseAdapterConfig,
  ): Promise<DatasourceCapabilities> {
    const validation = validateClickHouseConfig(config);
    if (!validation.valid) {
      throw new AdapterError("CONFIG_INVALID", "ClickHouse adapter config is invalid.", {
        details: { errors: validation.errors },
      });
    }
    return {
      ...CLICKHOUSE_CAPABILITIES,
      nativeQueryLanguages: config.allowNativeQueries ? ["sql"] : [],
    };
  }

  async compile(
    query: SemanticQuery,
    context: CompileContext,
  ): Promise<CompiledQuery<ClickHouseCompiledStatement>> {
    const compiled = deepFreeze(compileClickHouseQuery(query, this.config, context));
    this.compiledQueries.add(compiled);
    return compiled;
  }

  async execute(
    query: CompiledQuery<ClickHouseCompiledStatement> | NativeQuery,
    context: ExecutionContext,
  ): Promise<QueryResult> {
    let statement: string;
    let parameters: Record<string, unknown>;
    let fields: CompiledQuery<ClickHouseCompiledStatement>["fields"] | undefined;
    let frameName: string;

    if (isCompiledQuery<ClickHouseCompiledStatement>(query)) {
      if (!this.compiledQueries.has(query)) {
        throw new AdapterError(
          "QUERY_VALIDATION_FAILED",
          "Compiled query was not produced by this adapter instance.",
        );
      }
      statement = query.compiled.statement;
      parameters = query.parameters;
      fields = query.fields;
      frameName = query.source.resourceName;
    } else {
      if (!this.config.allowNativeQueries) {
        throw new AdapterError(
          "NATIVE_QUERY_REJECTED",
          "Native SQL is disabled for this ClickHouse datasource.",
          { path: "/spec/native" },
        );
      }
      const native = compileNativeQuery(query, context.variables);
      statement = native.statement;
      parameters = native.parameters;
      frameName = query.metadata.name;
    }

    const timeoutMs = Math.min(
      context.timeoutMs ?? this.config.queryTimeoutMs ?? DEFAULT_QUERY_TIMEOUT_MS,
      this.config.queryTimeoutMs ?? DEFAULT_QUERY_TIMEOUT_MS,
    );
    const scope = abortScope(context.abortSignal, timeoutMs);
    const started = this.now();

    const settings: ClickHouseSettings = {
      readonly: "1",
      max_execution_time: Math.max(1, Math.ceil(timeoutMs / 1_000)),
      max_result_rows: String(this.config.maxResultRows ?? DEFAULT_MAX_RESULT_ROWS),
      result_overflow_mode: "throw",
      max_rows_to_read: String(this.config.maxRowsToRead ?? DEFAULT_MAX_ROWS_TO_READ),
      read_overflow_mode: "throw",
    };

    try {
      const resultSet = await this.client.query({
        query: statement,
        format: "JSON",
        query_params: parameters,
        clickhouse_settings: settings,
        abort_signal: scope.signal,
        query_id: queryId(context),
      });
      const response = (await resultSet.json<ClickHouseRow>()) as ResponseJSON<ClickHouseRow>;
      return normalizeClickHouseResponse(response as ClickHouseResponse, fields, {
        frameName,
        adapterVersion: ADAPTER_VERSION,
        executionTimeMs: Math.max(0, this.now() - started),
      });
    } catch (error) {
      if (scope.timedOut()) {
        throw new AdapterError("TIMEOUT", `ClickHouse query exceeded ${timeoutMs}ms.`, {
          cause: error,
          details: { timeoutMs },
        });
      }
      if (context.abortSignal?.aborted || isAbortError(error)) {
        throw new AdapterError("ABORTED", "ClickHouse query was cancelled.", {
          cause: error,
        });
      }
      throw new AdapterError("EXECUTION_FAILED", "ClickHouse query execution failed.", {
        cause: error,
      });
    } finally {
      scope.dispose();
    }
  }

  async explain(
    query: SemanticQuery,
    context: CompileContext,
  ): Promise<QueryExplanation<ClickHouseCompiledStatement>> {
    const compiledQuery = await this.compile(query, context);
    const steps = [
      `Resolve logical dataset '${query.spec.input.entity}'.`,
      `Map ${query.spec.select.length} selected expression(s) to allowlisted ClickHouse expressions.`,
      "Bind all values as ClickHouse query parameters.",
    ];
    if (query.spec.timeRange) steps.push("Apply and validate the bounded time range.");
    if (this.config.tenant) steps.push("Apply the adapter-owned tenant predicate.");
    if (query.spec.where) steps.push("Compile the portable boolean filter tree.");
    if (query.spec.groupBy?.length) steps.push("Compile grouping and time buckets.");
    steps.push("Apply the configured maximum result limit.");
    return {
      summary: `Compile '${query.metadata.name}' to a read-only ClickHouse SQL query.`,
      steps,
      compiledQuery,
      warnings: compiledQuery.warnings,
    };
  }

  async discoverSchema(_context: DiscoveryContext): Promise<SemanticSchema> {
    return datasetsToSemanticSchema(createDatasetRegistry(this.config.datasets ?? []));
  }

  async close(): Promise<void> {
    if (this.ownsClient) await this.client.close();
  }
}
