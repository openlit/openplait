import type { TimeRange } from "@openplait/core";
import type { HttpAdapterConfig } from "@openplait/adapter-sdk";

export interface LokiAdapterConfig extends HttpAdapterConfig {
  allowNativeQueries?: boolean;
  maxResultRows?: number;
  maxTimeRangeMs?: number;
  maxLookbackMs?: number;
  labelFields?: Record<string, string>;
}
export interface LokiAdapterOptions { fetch?: typeof fetch; now?: () => number }
export interface LokiCompiledRequest { endpoint: "query_range"; logql: string; startNs: string; endNs: string; limit: number; direction: "forward" | "backward" }
export interface LokiNativeOptions { timeRange: Omit<TimeRange, "field">; limit?: number; direction?: "forward" | "backward" }
export interface LokiApiResponse {
  status: "success" | "error";
  errorType?: string;
  error?: string;
  data?: { resultType?: "streams" | "matrix" | "vector" | "scalar"; result?: Array<{ stream?: Record<string, string>; metric?: Record<string, string>; values?: Array<[string | number, string | number]>; value?: [string | number, string | number] }> };
}
