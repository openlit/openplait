import { AdapterError } from "@openplait/adapter-sdk";
import type { QueryResult } from "@openplait/core";
import type { PrometheusApiResponse } from "./types.js";

export function normalizePrometheusResponse(response: PrometheusApiResponse, frameName: string, adapterVersion: string, executionTimeMs: number): QueryResult {
  if (response.status !== "success") throw new AdapterError("EXECUTION_FAILED", response.error || "Prometheus query failed.", { details: { errorType: response.errorType } });
  const result = response.data?.result;
  const rows: Array<{ timestamp: string; value: number; labels: Record<string, string> }> = [];
  if (Array.isArray(result)) {
    if (response.data?.resultType === "scalar" || response.data?.resultType === "string") {
      const scalar = result as unknown as [number | string, number | string];
      rows.push({ timestamp: new Date(Number(scalar[0]) * 1000).toISOString(), value: Number(scalar[1]), labels: {} });
    } else {
      for (const series of result as Array<{ metric?: Record<string, string>; values?: Array<[number | string, number | string]>; value?: [number | string, number | string] }>) {
        const samples = series.values ?? (series.value ? [series.value] : []);
        for (const sample of samples) rows.push({ timestamp: new Date(Number(sample[0]) * 1000).toISOString(), value: Number(sample[1]), labels: series.metric ?? {} });
      }
    }
  }
  return {
    frames: [{ name: frameName, length: rows.length, fields: [
      { name: "timestamp", type: "time", values: rows.map((row) => row.timestamp) },
      { name: "value", type: "number", values: rows.map((row) => row.value) },
      { name: "labels", type: "json", values: rows.map((row) => row.labels) },
    ] }],
    metadata: { adapterVersion, executionTimeMs, rowsReturned: rows.length, ...(response.warnings?.length ? { warnings: response.warnings } : {}) },
  };
}
