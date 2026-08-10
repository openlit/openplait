import type {
  DataFieldType,
  NativeQuery,
  ParameterMap,
  QueryResult,
  SemanticQuery,
  SemanticSchema,
  SignalType,
} from "@openplait/core";

export type QueryOperation =
  | "select"
  | "filter"
  | "aggregate"
  | "group"
  | "order"
  | "limit"
  | "timeBucket"
  | "rate"
  | "percentile"
  | "distinctCount"
  | "histogram"
  | "arithmetic"
  | "join";

export interface JoinCapabilities {
  local: boolean;
  crossDatasource: boolean;
}

export interface DatasourceCapabilities {
  signals: SignalType[];
  operations: QueryOperation[];
  joins: JoinCapabilities;
  nativeQueryLanguages?: string[];
  explain?: boolean;
  schemaDiscovery?: boolean;
  /** Adapter-neutral execution ceilings known for this configured source. */
  limits?: {
    maxResultRows?: number;
    maxTimeRangeMs?: number;
    maxLookbackMs?: number;
  };
  /** Namespaced backend-specific capabilities that do not belong in core IR. */
  extensions?: Record<string, unknown>;
}

export interface AdapterManifest {
  name: string;
  displayName: string;
  version: string;
  queryLanguages: string[];
  signals: SignalType[];
}

export interface AdapterValidationIssue {
  code: string;
  path: string;
  message: string;
}

export type AdapterValidationResult<T> =
  | { valid: true; value: T; errors: [] }
  | { valid: false; errors: AdapterValidationIssue[] };

export interface AuditContext {
  requestId: string;
  actorId?: string;
  tenantId?: string;
  attributes?: Record<string, string>;
}

export interface CompileContext {
  variables?: ParameterMap;
  maxResultRows?: number;
  now?: Date;
}

export interface ExecutionContext {
  audit: AuditContext;
  variables?: ParameterMap;
  abortSignal?: AbortSignal;
  timeoutMs?: number;
  queryId?: string;
}

export interface DiscoveryContext {
  abortSignal?: AbortSignal;
  timeoutMs?: number;
  /**
   * Optional discovery window. Backends such as Loki require `start`/`end` on
   * label APIs; adapters that need it should read these timestamps.
   */
  timeRange?: { from: string | Date; to: string | Date };
}

export interface CompiledField {
  name: string;
  type: DataFieldType;
  unit?: string;
  source?: string;
}

export interface CompiledQuery<TCompiledQuery> {
  kind: "CompiledQuery";
  language: string;
  compiled: TCompiledQuery;
  parameters: Record<string, unknown>;
  fields: CompiledField[];
  source: {
    resourceName: string;
    dataset: string;
  };
  warnings: string[];
}

export interface QueryExplanation<TCompiledQuery = unknown> {
  summary: string;
  steps: string[];
  compiledQuery?: CompiledQuery<TCompiledQuery>;
  warnings: string[];
}

export interface DatasourceAdapter<TConfig = unknown, TCompiledQuery = unknown> {
  readonly manifest: AdapterManifest;

  validateConfig(config: TConfig): AdapterValidationResult<TConfig>;

  getCapabilities(config: TConfig): Promise<DatasourceCapabilities>;

  compile(
    query: SemanticQuery,
    context: CompileContext,
  ): Promise<CompiledQuery<TCompiledQuery>>;

  execute(
    query: CompiledQuery<TCompiledQuery> | NativeQuery,
    context: ExecutionContext,
  ): Promise<QueryResult>;

  explain?(
    query: SemanticQuery,
    context: CompileContext,
  ): Promise<QueryExplanation<TCompiledQuery>>;

  discoverSchema?(context: DiscoveryContext): Promise<SemanticSchema>;
}
