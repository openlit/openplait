import type { TimeRange } from "@openplait/core";
import type { HttpAdapterConfig } from "@openplait/adapter-sdk";

export interface PrometheusAdapterConfig extends HttpAdapterConfig {
  allowNativeQueries?: boolean;
  maxResultRows?: number;
  maxSeries?: number;
  maxTimeRangeMs?: number;
  maxLookbackMs?: number;
  defaultStep?: string;
  labelFields?: Record<string, string>;
}

export interface PrometheusAdapterOptions { fetch?: typeof fetch; now?: () => number }
export interface PrometheusCompiledRequest { endpoint: "query_range"; promql: string; start: number; end: number; step: string }
export interface PrometheusNativeOptions { timeRange: Omit<TimeRange, "field">; step?: string }
export interface PrometheusApiResponse {
  status: "success" | "error";
  errorType?: string;
  error?: string;
  warnings?: string[];
  data?: {
    resultType?: "matrix" | "vector" | "scalar" | "string";
    result?: Array<{ metric?: Record<string, string>; values?: Array<[number | string, number | string]>; value?: [number | string, number | string] }> | [number | string, number | string];
  };
}
