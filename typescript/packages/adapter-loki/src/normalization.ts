import { AdapterError } from "@openplait/adapter-sdk";
import type { QueryResult } from "@openplait/core";
import type { LokiApiResponse } from "./types.js";

export function normalizeLokiResponse(response: LokiApiResponse, frameName: string, adapterVersion: string, executionTimeMs: number): QueryResult {
  if (response.status !== "success") throw new AdapterError("EXECUTION_FAILED", response.error || "Loki query failed.", { details: { errorType: response.errorType } });
  const rows: Array<{ timestamp: string; body: string; labels: Record<string, string>; value?: number }> = [];
  for (const series of response.data?.result ?? []) {
    const labels = series.stream ?? series.metric ?? {};
    for (const sample of series.values ?? (series.value ? [series.value] : [])) {
      const raw = Number(sample[0]);
      const timestampMs = raw > 10_000_000_000_000 ? raw / 1_000_000 : raw * 1_000;
      const metric = response.data?.resultType !== "streams";
      rows.push({ timestamp: new Date(timestampMs).toISOString(), body: metric ? "" : String(sample[1]), labels, ...(metric ? { value: Number(sample[1]) } : {}) });
    }
  }
  const metric = response.data?.resultType !== "streams";
  return { frames: [{ name: frameName, length: rows.length, fields: [
    { name: "timestamp", type: "time", values: rows.map((row) => row.timestamp) },
    ...(metric ? [{ name: "value" as const, type: "number" as const, values: rows.map((row) => row.value) }] : [{ name: "body" as const, type: "string" as const, values: rows.map((row) => row.body) }]),
    { name: "labels", type: "json", values: rows.map((row) => row.labels) },
  ] }], metadata: { adapterVersion, executionTimeMs, rowsReturned: rows.length } };
}
