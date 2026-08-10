import type {
  DatasourceReference,
  ParameterMap,
  Query,
  QueryResult,
  SemanticQuery,
  Transformation,
} from "@openplait/core";
import type {
  AdapterManifest,
  AuditContext,
  CompileContext,
  DatasourceAdapter,
  DatasourceCapabilities,
  ExecutionContext,
} from "@openplait/adapter-sdk";

export type DatasourceScope = NonNullable<DatasourceReference["scope"]>;

export interface RuntimeDatasourceRegistration<TConfig = unknown, TCompiled = unknown> {
  name: string;
  kind: string;
  scope?: DatasourceScope;
  config: TConfig;
  adapter: DatasourceAdapter<TConfig, TCompiled>;
}

export interface RuntimeDatasourceHandle {
  name: string;
  kind: string;
  scope: DatasourceScope;
  manifest: AdapterManifest;
  getCapabilities(): Promise<DatasourceCapabilities>;
  compile(query: SemanticQuery, context: CompileContext): Promise<unknown>;
  execute(query: unknown, context: ExecutionContext): Promise<QueryResult>;
}

export interface PlannedQuery {
  original: Query;
  executable: Query;
  datasource: { name: string; kind: string; scope: DatasourceScope; adapter: string; version: string };
}

export interface ExecutionPlan {
  queries: PlannedQuery[];
  sourceTransformations: Transformation[];
  runtimeTransformations: Transformation[];
  clientTransformations: Transformation[];
}

export interface RuntimeCache {
  get(key: string): Promise<QueryResult | undefined>;
  set(key: string, value: QueryResult): Promise<void>;
}

export interface RuntimeHooks {
  onPlan?(plan: ExecutionPlan): void | Promise<void>;
  onQueryStart?(query: PlannedQuery): void | Promise<void>;
  onQueryComplete?(query: PlannedQuery, result: QueryResult): void | Promise<void>;
  onError?(error: unknown): void | Promise<void>;
}

export interface RuntimeExecutionRequest {
  queries: Query[];
  transformations?: Transformation[];
  variables?: ParameterMap;
  audit: AuditContext;
  abortSignal?: AbortSignal;
  timeoutMs?: number;
}

export interface RuntimeQueryMetadata {
  query: string;
  datasource: string;
  adapter: string;
  adapterVersion: string;
  cache: "hit" | "miss" | "bypass";
  executionTimeMs: number;
  rowsReturned: number;
  rowsRead?: number;
}

export interface RuntimeExecutionMetadata {
  executionTimeMs: number;
  queryCount: number;
  sourceTransformations: string[];
  runtimeTransformations: string[];
  clientTransformations: string[];
  queries: RuntimeQueryMetadata[];
  warnings: string[];
}

export interface RuntimeExecutionResponse {
  result: QueryResult;
  plan: ExecutionPlan;
  deferredTransformations: Transformation[];
  metadata: RuntimeExecutionMetadata;
}

export interface OpenPlaitRuntimeOptions {
  cache?: RuntimeCache;
  hooks?: RuntimeHooks;
  defaultTimeoutMs?: number;
  now?: () => number;
}
