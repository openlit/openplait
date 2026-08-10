import type { CompiledField } from "@openplait/adapter-sdk";
import type { DataField, QueryResult } from "@openplait/core";

import type {
  JaegerNormalizedSpan,
  JaegerProcess,
  JaegerSpan,
  JaegerTag,
  JaegerTrace,
} from "./types.js";

function tagsToMap(tags?: JaegerTag[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const tag of tags || []) {
    if (tag.key !== undefined) out[tag.key] = String(tag.value);
  }
  return out;
}

export function normalizeJaegerSpan(
  span: JaegerSpan,
  processes: Record<string, JaegerProcess>,
): JaegerNormalizedSpan {
  const process = span.processID ? processes[span.processID] : undefined;
  const resourceAttributes = tagsToMap(process?.tags);
  const serviceName =
    process?.serviceName || resourceAttributes["service.name"] || "";
  if (serviceName) resourceAttributes["service.name"] = serviceName;
  const spanAttributes = tagsToMap(span.tags);
  const parentRef = (span.references || []).find(
    (ref) => ref.refType === "CHILD_OF" || ref.refType === "FOLLOWS_FROM",
  );
  const events = (span.logs || []).map((log) => {
    const fields = tagsToMap(log.fields);
    const timestamp = log.timestamp
      ? new Date(log.timestamp / 1000).toISOString()
      : undefined;
    return {
      name: fields.event || fields.name || "log",
      ...(timestamp ? { timestamp } : {}),
      attributes: fields,
    };
  });
  const statusCode =
    spanAttributes["otel.status_code"] ||
    (spanAttributes.error === "true" ? "STATUS_CODE_ERROR" : "");
  const costStr = spanAttributes["gen_ai.usage.cost"];

  return {
    traceId: String(span.traceID || ""),
    spanId: String(span.spanID || ""),
    parentSpanId: String(parentRef?.spanID || ""),
    name: String(span.operationName || ""),
    serviceName,
    timestamp: span.startTime
      ? new Date(span.startTime / 1000).toISOString()
      : "",
    durationNs: Math.round((span.duration || 0) * 1000),
    statusCode,
    ...(spanAttributes["span.kind"] ? { spanKind: spanAttributes["span.kind"] } : {}),
    spanAttributes,
    resourceAttributes,
    events,
    ...(costStr !== undefined ? { cost: Number(costStr) || 0 } : {}),
  };
}

export function flattenJaegerTraces(traces: JaegerTrace[]): JaegerNormalizedSpan[] {
  const spans: JaegerNormalizedSpan[] = [];
  for (const trace of traces) {
    const processes = trace.processes || {};
    for (const span of trace.spans || []) {
      spans.push(normalizeJaegerSpan(span, processes));
    }
  }
  return spans;
}

const DEFAULT_FIELDS: CompiledField[] = [
  { name: "trace.id", source: "traceId", type: "trace" },
  { name: "span.id", source: "spanId", type: "string" },
  { name: "timestamp", source: "timestamp", type: "time" },
  { name: "duration", source: "durationNs", type: "duration", unit: "ns" },
  { name: "service.name", source: "serviceName", type: "string" },
  { name: "span.name", source: "name", type: "string" },
  { name: "status.code", source: "statusCode", type: "string" },
];

function fieldValues(spans: JaegerNormalizedSpan[], source: string): unknown[] {
  return spans.map((span) => {
    const record = span as unknown as Record<string, unknown>;
    return record[source] ?? null;
  });
}

function dataField(field: CompiledField, values: unknown[]): DataField {
  return {
    name: field.name,
    type: field.type,
    ...(field.unit ? { unit: field.unit } : {}),
    values,
  };
}

export function normalizeJaegerSearchResponse(
  traces: JaegerTrace[],
  fields: CompiledField[] = DEFAULT_FIELDS,
): QueryResult {
  const spans = flattenJaegerTraces(traces);
  return {
    frames: [
      {
        name: "spans",
        length: spans.length,
        fields: fields.map((field) =>
          dataField(field, fieldValues(spans, field.source ?? field.name)),
        ),
      },
    ],
  };
}

export function normalizeJaegerTraceResponse(trace: JaegerTrace): QueryResult {
  return normalizeJaegerSearchResponse([trace]);
}
