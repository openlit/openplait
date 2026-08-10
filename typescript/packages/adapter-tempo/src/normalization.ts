import type { CompiledField } from "@openplait/adapter-sdk";
import type { DataField, DataFieldType, QueryResult } from "@openplait/core";

import { TEMPO_TRACE_FIELDS } from "./datasets.js";
import type {
  TempoNormalizationOptions,
  TempoMetricsResponse,
  TempoSearchResponse,
  TempoSearchTrace,
  TempoTraceResponse,
} from "./types.js";

const DEFAULT_SEARCH_FIELDS: CompiledField[] = [
  { name: "trace.id", source: "trace.id", type: "trace" },
  { name: "timestamp", source: "timestamp", type: "time" },
  { name: "duration", source: "duration", type: "duration", unit: "ms" },
  { name: "root.service.name", source: "root.service.name", type: "string" },
  { name: "root.span.name", source: "root.span.name", type: "string" },
  { name: "matched.spans", source: "matched.spans", type: "number" },
];

function finiteNumber(value: unknown): number | null {
  const parsed = typeof value === "number" ? value : typeof value === "string" ? Number(value) : Number.NaN;
  return Number.isFinite(parsed) ? parsed : null;
}

function nanos(value: unknown): bigint | null {
  if (typeof value === "bigint") return value;
  if (typeof value === "string" && /^\d+$/.test(value)) {
    try {
      return BigInt(value);
    } catch {
      return null;
    }
  }
  if (typeof value === "number" && Number.isFinite(value)) return BigInt(Math.trunc(value));
  return null;
}

function nanosToIso(value: unknown): string | null {
  const nanoseconds = nanos(value);
  if (nanoseconds === null) return null;
  const date = new Date(Number(nanoseconds / 1_000_000n));
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

/** OTLP/JSON protobuf encodes byte IDs as base64; Tempo search uses hex. */
export function normalizeTempoId(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const id = value.trim();
  if (!id) return null;
  if (/^[0-9a-fA-F]+$/.test(id) && (id.length === 16 || id.length === 32)) return id.toLowerCase();
  try {
    const bytes = Buffer.from(id, "base64");
    if (bytes.length === 8 || bytes.length === 16) return bytes.toString("hex");
  } catch {
    // Preserve an unknown representation so callers can still display it.
  }
  return id;
}

function matchedSpans(trace: TempoSearchTrace): number | null {
  const sets = trace.spanSets ?? (trace.spanSet ? [trace.spanSet] : []);
  if (!sets.length) return null;
  return sets.reduce((total, set) => total + (finiteNumber(set.matched) ?? set.spans?.length ?? 0), 0);
}

function summaryValue(trace: TempoSearchTrace, source: string): unknown {
  if (source === "matched.spans") return matchedSpans(trace);
  const resultKey = TEMPO_TRACE_FIELDS[source]?.resultKey;
  if (!resultKey) return null;
  const value = trace[resultKey];
  if (source === "timestamp") return nanosToIso(value);
  if (source === "duration") return finiteNumber(value);
  return value ?? null;
}

function dataField(field: CompiledField, values: unknown[]): DataField {
  return {
    name: field.name,
    type: field.type,
    values,
    ...(field.unit === undefined ? {} : { unit: field.unit }),
  };
}

export function normalizeTempoSearchResponse(
  response: TempoSearchResponse,
  options: TempoNormalizationOptions,
): QueryResult {
  const traces = Array.isArray(response.traces) ? response.traces : [];
  const fields = options.fields?.length ? options.fields : DEFAULT_SEARCH_FIELDS;
  const inspected = finiteNumber(response.metrics?.inspectedTraces);
  return {
    frames: [
      {
        name: options.frameName,
        length: traces.length,
        fields: fields.map((field) => dataField(field, traces.map((trace) => summaryValue(trace, field.source ?? field.name)))),
      },
    ],
    metadata: {
      datasource: "tempo",
      adapterVersion: options.adapterVersion,
      executionTimeMs: options.executionTimeMs,
      ...(inspected === null ? {} : { rowsRead: inspected }),
      rowsReturned: traces.length,
      cache: "bypass",
      warnings: [],
    },
  };
}

function anyValue(value: unknown): unknown {
  if (typeof value !== "object" || value === null) return value;
  const item = value as Record<string, unknown>;
  for (const key of ["stringValue", "boolValue", "intValue", "doubleValue", "bytesValue"] as const) {
    if (key in item) return item[key];
  }
  if (Array.isArray(item.arrayValue)) return item.arrayValue.map(anyValue);
  const array = (item.arrayValue as { values?: unknown[] } | undefined)?.values;
  if (Array.isArray(array)) return array.map(anyValue);
  const entries = (item.kvlistValue as { values?: Array<{ key?: string; value?: unknown }> } | undefined)?.values;
  if (Array.isArray(entries)) return Object.fromEntries(entries.filter((entry) => entry.key).map((entry) => [entry.key as string, anyValue(entry.value)]));
  return item;
}

function attributes(value: unknown): Record<string, unknown> {
  if (!Array.isArray(value)) return {};
  return Object.fromEntries(
    value
      .filter((item): item is { key: string; value?: unknown } => typeof item === "object" && item !== null && typeof (item as { key?: unknown }).key === "string")
      .map((item) => [item.key, anyValue(item.value)]),
  );
}

function statusCode(value: unknown): string | null {
  if (typeof value === "string") return value.replace(/^STATUS_CODE_/, "").toLowerCase();
  return ({ 0: "unset", 1: "ok", 2: "error" } as Record<number, string>)[Number(value)] ?? null;
}

function spanKind(value: unknown): string | null {
  if (typeof value === "string") return value.replace(/^SPAN_KIND_/, "").toLowerCase();
  return ({ 0: "unspecified", 1: "internal", 2: "server", 3: "client", 4: "producer", 5: "consumer" } as Record<number, string>)[Number(value)] ?? null;
}

interface SpanRow {
  timestamp: string | null;
  duration: number | null;
  "trace.id": unknown;
  "span.id": unknown;
  "span.parent_id": unknown;
  "span.name": unknown;
  "span.kind": string | null;
  "status.code": string | null;
  "status.message": unknown;
  "service.name": unknown;
  "resource.attributes": Record<string, unknown>;
  "span.attributes": Record<string, unknown>;
  events: unknown[];
}

function spanRows(response: TempoTraceResponse): SpanRow[] {
  const resourceSpans = Array.isArray(response.resourceSpans)
    ? response.resourceSpans
    : Array.isArray(response.batches)
      ? response.batches
      : [];
  const rows: SpanRow[] = [];
  for (const rawResource of resourceSpans) {
    const resource = rawResource as Record<string, unknown>;
    const resourceAttributes = attributes((resource.resource as Record<string, unknown> | undefined)?.attributes);
    const scopes = (resource.scopeSpans ?? resource.instrumentationLibrarySpans) as unknown;
    if (!Array.isArray(scopes)) continue;
    for (const rawScope of scopes) {
      const spans = (rawScope as Record<string, unknown>).spans;
      if (!Array.isArray(spans)) continue;
      for (const rawSpan of spans) {
        if (typeof rawSpan !== "object" || rawSpan === null) continue;
        const span = rawSpan as Record<string, unknown>;
        const start = nanos(span.startTimeUnixNano);
        const end = nanos(span.endTimeUnixNano);
        rows.push({
          timestamp: nanosToIso(span.startTimeUnixNano),
          duration: start === null || end === null
            ? null
            : Math.max(0, Number(end - start) / 1_000_000),
          "trace.id": normalizeTempoId(span.traceId),
          "span.id": normalizeTempoId(span.spanId),
          "span.parent_id": normalizeTempoId(span.parentSpanId),
          "span.name": span.name ?? null,
          "span.kind": spanKind(span.kind),
          "status.code": statusCode((span.status as Record<string, unknown> | undefined)?.code),
          "status.message": (span.status as Record<string, unknown> | undefined)?.message ?? null,
          "service.name": resourceAttributes["service.name"] ?? null,
          "resource.attributes": resourceAttributes,
          "span.attributes": attributes(span.attributes),
          events: Array.isArray(span.events) ? span.events : [],
        });
      }
    }
  }
  return rows;
}

const TRACE_DETAIL_FIELDS: ReadonlyArray<{ name: keyof SpanRow; type: DataFieldType; unit?: string }> = [
  { name: "timestamp", type: "time" },
  { name: "duration", type: "duration", unit: "ms" },
  { name: "trace.id", type: "trace" },
  { name: "span.id", type: "string" },
  { name: "span.parent_id", type: "string" },
  { name: "span.name", type: "string" },
  { name: "span.kind", type: "string" },
  { name: "status.code", type: "string" },
  { name: "status.message", type: "string" },
  { name: "service.name", type: "string" },
  { name: "resource.attributes", type: "json" },
  { name: "span.attributes", type: "json" },
  { name: "events", type: "json" },
];

export function normalizeTempoTraceResponse(
  response: TempoTraceResponse,
  options: Omit<TempoNormalizationOptions, "fields">,
): QueryResult {
  const rows = spanRows(response);
  return {
    frames: [{
      name: options.frameName,
      length: rows.length,
      fields: TRACE_DETAIL_FIELDS.map((field) => ({
        name: field.name,
        type: field.type,
        values: rows.map((row) => row[field.name]),
        ...(field.unit === undefined ? {} : { unit: field.unit }),
      })),
    }],
    metadata: {
      datasource: "tempo",
      adapterVersion: options.adapterVersion,
      executionTimeMs: options.executionTimeMs,
      rowsReturned: rows.length,
      cache: "bypass",
      warnings: [],
    },
  };
}

function metricLabelValue(value: unknown): string {
  if (typeof value === "string") return value;
  if (typeof value !== "object" || value === null) return "";
  const wrapped = value as { stringValue?: unknown; string_value?: unknown };
  return String(wrapped.stringValue ?? wrapped.string_value ?? "");
}

/** Normalize Prometheus-like TraceQL metric series into one row per sample. */
export function normalizeTempoMetricsResponse(
  response: TempoMetricsResponse,
  options: Omit<TempoNormalizationOptions, "fields">,
): QueryResult {
  const rows: Array<{ timestamp: string | null; value: number | null; labels: Record<string, string> }> = [];
  for (const series of response.series ?? []) {
    const labels = Object.fromEntries(
      (series.labels ?? [])
        .filter((label): label is typeof label & { key: string } => typeof label.key === "string")
        .map((label) => [label.key, metricLabelValue(label.value)]),
    );
    if (Array.isArray(series.samples)) {
      for (const sample of series.samples) {
        const milliseconds = finiteNumber(sample.timestampMs ?? sample.timestamp_ms);
        rows.push({
          timestamp: milliseconds === null ? null : new Date(milliseconds).toISOString(),
          value: finiteNumber(sample.value),
          labels,
        });
      }
    } else if (Array.isArray(series.values)) {
      for (const [seconds, value] of series.values) {
        rows.push({
          timestamp: Number.isFinite(seconds) ? new Date(seconds * 1_000).toISOString() : null,
          value: finiteNumber(value),
          labels,
        });
      }
    }
  }
  return {
    frames: [{
      name: options.frameName,
      length: rows.length,
      fields: [
        { name: "timestamp", type: "time", values: rows.map((row) => row.timestamp) },
        { name: "value", type: "number", values: rows.map((row) => row.value) },
        { name: "labels", type: "json", values: rows.map((row) => row.labels) },
      ],
    }],
    metadata: {
      datasource: "tempo",
      adapterVersion: options.adapterVersion,
      executionTimeMs: options.executionTimeMs,
      rowsReturned: rows.length,
      cache: "bypass",
      warnings: [],
    },
  };
}
