import type { DataFieldType, SemanticSchema } from "@openplait/core";

export interface TempoFieldMapping {
  traceql: string;
  type: DataFieldType;
  unit?: string;
  selectable: boolean;
  resultKey?: string;
  valueKind?: "string" | "number" | "boolean" | "duration" | "status" | "kind" | "traceId";
  description?: string;
}

const field = (
  traceql: string,
  type: DataFieldType,
  resultKey: string | undefined,
  valueKind: TempoFieldMapping["valueKind"],
  options: { unit?: string; description?: string } = {},
): TempoFieldMapping => ({
  traceql,
  type,
  selectable: resultKey !== undefined,
  ...(resultKey === undefined ? {} : { resultKey }),
  ...(valueKind === undefined ? {} : { valueKind }),
  ...(options.unit === undefined ? {} : { unit: options.unit }),
  ...(options.description === undefined ? {} : { description: options.description }),
});

/**
 * Tempo's search endpoint returns trace summaries. Span fields are deliberately
 * filter-only; use TempoAdapter.getTrace() when complete span rows are needed.
 */
export const TEMPO_TRACE_FIELDS: Readonly<Record<string, TempoFieldMapping>> = {
  timestamp: field("", "time", "startTimeUnixNano", undefined),
  duration: field("trace:duration", "duration", "durationMs", "duration", { unit: "ms" }),
  "trace.id": field("trace:id", "trace", "traceID", "traceId"),
  "root.service.name": field("trace:rootService", "string", "rootServiceName", "string"),
  "root.span.name": field("trace:rootName", "string", "rootTraceName", "string"),
  "matched.spans": field("", "number", "matchedSpans", "number"),
  "span.name": field("span:name", "string", undefined, "string"),
  "span.id": field("span:id", "string", undefined, "string"),
  "span.parent_id": field("span:parentID", "string", undefined, "string"),
  "span.kind": field("span:kind", "string", undefined, "kind"),
  "status.code": field("span:status", "string", undefined, "status"),
  "status.message": field("span:statusMessage", "string", undefined, "string"),
  "span.duration": field("span:duration", "duration", undefined, "duration", { unit: "ms" }),
  "service.name": field("resource.service.name", "string", undefined, "string"),
  "instrumentation.name": field("instrumentation:name", "string", undefined, "string"),
  "instrumentation.version": field("instrumentation:version", "string", undefined, "string"),
};

export const TEMPO_DATASET_NAME = "tempo.trace_search";

export function tempoSemanticSchema(): SemanticSchema {
  return {
    datasets: [
      {
        name: TEMPO_DATASET_NAME,
        signal: "traces",
        fields: Object.entries(TEMPO_TRACE_FIELDS)
          .filter(([, mapping]) => mapping.selectable)
          .map(([name, mapping]) => ({
            name,
            type: mapping.type,
            ...(mapping.unit === undefined ? {} : { unit: mapping.unit }),
            ...(mapping.description === undefined ? {} : { description: mapping.description }),
            signals: ["traces"],
          })),
        extensions: {
          "io.openplait.tempo": {
            filterOnlyFields: Object.entries(TEMPO_TRACE_FIELDS)
              .filter(([, mapping]) => !mapping.selectable && mapping.traceql)
              .map(([name]) => name),
            traceDetail: true,
          },
        },
      },
    ],
  };
}
