import type { DataFieldType, TimeRange } from "@openplait/core";
import type { CompiledField } from "@openplait/adapter-sdk";

export type TempoAttributeScope = "resource" | "span" | "event" | "link";

export interface TempoAttributeField {
  scope: TempoAttributeScope;
  attribute: string;
  type?: Exclude<DataFieldType, "time" | "duration" | "trace" | "json">;
}

export interface TempoAdapterConfig {
  url: string;
  /** Static headers for proxies and managed Tempo services. */
  httpHeaders?: Record<string, string>;
  tenantId?: string;
  username?: string;
  password?: string;
  bearerToken?: string;
  requestTimeoutMs?: number;
  queryTimeoutMs?: number;
  maxResultRows?: number;
  maxSpansPerSpanSet?: number;
  maxTimeRangeMs?: number;
  allowNativeQueries?: boolean;
  /** Tempo version reported by `/api/status/buildinfo`, when already known. */
  tempoVersion?: string;
  /** Override the version-derived experimental `most_recent` query hint. */
  enableMostRecent?: boolean;
  /** Override the version-derived TraceQL metrics capability. */
  enableTraceqlMetrics?: boolean;
  /** Override use of the v2 tag and tag-value discovery endpoints. */
  enableTagSearchV2?: boolean;
  /** Additional canonical field names that may be used in semantic filters. */
  attributeFields?: Record<string, TempoAttributeField>;
}

export interface TempoServerCapabilities {
  version?: string;
  features: {
    traceql: boolean | null;
    mostRecent: boolean | null;
    traceqlMetrics: boolean | null;
    tagSearchV2: boolean | null;
  };
  limits: {
    maxResultRows?: number;
    maxTimeRangeMs?: number;
    maxSpansPerSpanSet?: number;
  };
}

export interface TempoAdapterOptions {
  fetch?: typeof fetch;
  now?: () => number;
}

export interface TempoCompiledRequest {
  endpoint: "search";
  traceql: string;
  start: number;
  end: number;
  limit: number;
  spansPerSpanSet: number;
}

export interface TempoNativeOptions {
  timeRange: Omit<TimeRange, "field">;
  limit?: number;
  spansPerSpanSet?: number;
}

export interface TempoTraceRange {
  from: string | number;
  to: string | number;
}

export interface TempoMetricsRange extends TempoTraceRange {
  query: string;
  /** Tempo/Go duration, for example `30s`, `5m`, or `1h`. */
  step: string;
  exemplars?: number;
}

export interface TempoMetricsSample {
  timestampMs?: string | number;
  timestamp_ms?: string | number;
  value?: string | number;
}

export interface TempoMetricsSeries {
  labels?: Array<{
    key?: string;
    value?: string | { stringValue?: string; string_value?: string };
  }>;
  samples?: TempoMetricsSample[];
  values?: [number, number][];
}

export interface TempoMetricsResponse {
  series?: TempoMetricsSeries[];
  [key: string]: unknown;
}

export interface TempoSearchTrace {
  traceID?: string;
  rootServiceName?: string;
  rootTraceName?: string;
  startTimeUnixNano?: string | number;
  durationMs?: number;
  spanSet?: TempoSpanSet;
  spanSets?: TempoSpanSet[];
  [key: string]: unknown;
}

export interface TempoSpanSet {
  matched?: number;
  spans?: Array<Record<string, unknown>>;
  [key: string]: unknown;
}

export interface TempoSearchResponse {
  traces?: TempoSearchTrace[];
  metrics?: Record<string, unknown>;
  [key: string]: unknown;
}

export interface TempoTraceResponse {
  resourceSpans?: Array<Record<string, unknown>>;
  batches?: Array<Record<string, unknown>>;
  [key: string]: unknown;
}

export interface TempoNormalizationOptions {
  frameName: string;
  adapterVersion: string;
  executionTimeMs: number;
  fields?: CompiledField[];
}
