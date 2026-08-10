import type { SemanticSchema } from "@openplait/core";

export const JAEGER_DATASET_NAME = "jaeger.traces";

export const JAEGER_TRACE_FIELDS: Record<
  string,
  { type: "string" | "time" | "duration" | "number" | "trace"; resultKey?: string }
> = {
  "trace.id": { type: "trace", resultKey: "traceId" },
  "span.id": { type: "string", resultKey: "spanId" },
  timestamp: { type: "time", resultKey: "timestamp" },
  duration: { type: "duration", resultKey: "durationNs" },
  "service.name": { type: "string", resultKey: "serviceName" },
  "span.name": { type: "string", resultKey: "name" },
  "status.code": { type: "string", resultKey: "statusCode" },
};

export function jaegerSemanticSchema(): SemanticSchema {
  return {
    datasets: [
      {
        name: JAEGER_DATASET_NAME,
        signal: "traces",
        fields: Object.entries(JAEGER_TRACE_FIELDS).map(([name, meta]) => ({
          name,
          type: meta.type,
        })),
      },
    ],
  };
}
