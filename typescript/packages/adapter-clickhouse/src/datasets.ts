import type { SemanticSchema } from "@openplait/core";

import type { ClickHouseDataset, ClickHouseFieldMapping } from "./types.js";

const stringField = (expression: string): ClickHouseFieldMapping => ({
  expression,
  type: "string",
  clickhouseType: "String",
});

const numberField = (
  expression: string,
  unit?: string,
): ClickHouseFieldMapping => ({
  expression,
  type: "number",
  clickhouseType: "Float64",
  ...(unit === undefined ? {} : { unit }),
});

const timeField = (expression: string): ClickHouseFieldMapping => ({
  expression,
  type: "time",
  clickhouseType: "DateTime64(9)",
});

const durationField = (
  expression: string,
  unit: string,
): ClickHouseFieldMapping => ({
  expression,
  type: "duration",
  clickhouseType: "UInt64",
  unit,
});

const resourceAttribute = (name: string): string =>
  `ResourceAttributes['${name}']`;
const spanAttribute = (name: string): string => `SpanAttributes['${name}']`;

const sharedResourceFields: Record<string, ClickHouseFieldMapping> = {
  "service.name": stringField("ServiceName"),
  "service.namespace": stringField(resourceAttribute("service.namespace")),
  "deployment.environment": stringField(
    resourceAttribute("deployment.environment"),
  ),
};

const metricFields: Record<string, ClickHouseFieldMapping> = {
  timestamp: timeField("TimeUnix"),
  ...sharedResourceFields,
  "metric.name": stringField("MetricName"),
  "metric.description": stringField("MetricDescription"),
  "metric.unit": stringField("MetricUnit"),
  "metric.value": numberField("Value"),
};

export const OTEL_CLICKHOUSE_DATASETS: readonly ClickHouseDataset[] = [
  {
    name: "otel.spans",
    signal: "traces",
    table: "otel_traces",
    timeField: "timestamp",
    fields: {
      timestamp: timeField("Timestamp"),
      duration: durationField("Duration", "ns"),
      ...sharedResourceFields,
      "trace.id": stringField("TraceId"),
      "span.id": stringField("SpanId"),
      "span.parent_id": stringField("ParentSpanId"),
      "span.name": stringField("SpanName"),
      "span.kind": stringField("SpanKind"),
      "status.code": stringField("StatusCode"),
      "status.message": stringField("StatusMessage"),
      "gen_ai.system": stringField(spanAttribute("gen_ai.system")),
      "gen_ai.provider.name": stringField(
        spanAttribute("gen_ai.provider.name"),
      ),
      "gen_ai.request.model": stringField(
        spanAttribute("gen_ai.request.model"),
      ),
      "gen_ai.operation.name": stringField(
        spanAttribute("gen_ai.operation.name"),
      ),
      "gen_ai.usage.input_tokens": numberField(
        `toUInt64OrZero(${spanAttribute("gen_ai.usage.input_tokens")})`,
        "tokens",
      ),
      "gen_ai.usage.output_tokens": numberField(
        `toUInt64OrZero(${spanAttribute("gen_ai.usage.output_tokens")})`,
        "tokens",
      ),
      "gen_ai.usage.cost": numberField(
        `toFloat64OrZero(${spanAttribute("gen_ai.usage.cost")})`,
        "currencyUSD",
      ),
    },
  },
  {
    name: "otel.logs",
    signal: "logs",
    table: "otel_logs",
    timeField: "timestamp",
    fields: {
      timestamp: timeField("Timestamp"),
      ...sharedResourceFields,
      "trace.id": stringField("TraceId"),
      "span.id": stringField("SpanId"),
      "log.severity": stringField("SeverityText"),
      "log.severity_number": numberField("SeverityNumber"),
      "log.body": stringField("Body"),
    },
  },
  {
    name: "otel.metrics.gauge",
    signal: "metrics",
    table: "otel_metrics_gauge",
    timeField: "timestamp",
    fields: { ...metricFields },
  },
  {
    name: "otel.metrics.sum",
    signal: "metrics",
    table: "otel_metrics_sum",
    timeField: "timestamp",
    fields: { ...metricFields },
  },
  {
    name: "otel.metrics.histogram",
    signal: "metrics",
    table: "otel_metrics_histogram",
    timeField: "timestamp",
    fields: {
      timestamp: timeField("TimeUnix"),
      ...sharedResourceFields,
      "metric.name": stringField("MetricName"),
      "metric.description": stringField("MetricDescription"),
      "metric.unit": stringField("MetricUnit"),
      "metric.count": numberField("Count"),
      "metric.sum": numberField("Sum"),
      "metric.min": numberField("Min"),
      "metric.max": numberField("Max"),
    },
  },
];

export const OPENLIT_CLICKHOUSE_DATASETS: readonly ClickHouseDataset[] = [
  {
    name: "openlit.evaluations",
    signal: "tabular",
    table: "openlit_evaluation",
    arrayJoin: "evaluationData",
    timeField: "timestamp",
    fields: {
      timestamp: timeField("created_at"),
      "span.id": stringField("span_id"),
      "evaluation.name": stringField("evaluationData.evaluation"),
      "evaluation.classification": stringField(
        "evaluationData.classification",
      ),
      "evaluation.explanation": stringField("evaluationData.explanation"),
      "evaluation.verdict": stringField("evaluationData.verdict"),
      "evaluation.source": stringField("meta['source']"),
    },
  },
  {
    name: "openlit.exceptions",
    signal: "logs",
    table: "otel_logs",
    timeField: "timestamp",
    fields: {
      timestamp: timeField("Timestamp"),
      ...sharedResourceFields,
      "trace.id": stringField("TraceId"),
      "span.id": stringField("SpanId"),
      "log.severity": stringField("SeverityText"),
      "log.severity_number": numberField("SeverityNumber"),
      "log.body": stringField("Body"),
    },
    defaultFilter: {
      field: "log.severity_number",
      operator: "greaterThanOrEqual",
      value: 17,
    },
  },
  {
    name: "openlit.costs",
    signal: "traces",
    table: "otel_traces",
    timeField: "timestamp",
    fields: {
      timestamp: timeField("Timestamp"),
      ...sharedResourceFields,
      "trace.id": stringField("TraceId"),
      "span.id": stringField("SpanId"),
      "gen_ai.request.model": stringField(
        spanAttribute("gen_ai.request.model"),
      ),
      "gen_ai.usage.cost": numberField(
        `toFloat64OrZero(${spanAttribute("gen_ai.usage.cost")})`,
        "currencyUSD",
      ),
    },
    defaultFilter: {
      field: "gen_ai.usage.cost",
      operator: "greaterThan",
      value: 0,
    },
  },
] as const;

export function createDatasetRegistry(
  overrides: readonly ClickHouseDataset[] = [],
): ReadonlyMap<string, ClickHouseDataset> {
  const registry = new Map<string, ClickHouseDataset>();
  for (const dataset of [...OTEL_CLICKHOUSE_DATASETS, ...overrides]) {
    registry.set(dataset.name, dataset);
  }
  return registry;
}

export function datasetsToSemanticSchema(
  datasets: ReadonlyMap<string, ClickHouseDataset>,
): SemanticSchema {
  return {
    datasets: [...datasets.values()].map((dataset) => ({
      name: dataset.name,
      signal: dataset.signal,
      fields: Object.entries(dataset.fields).map(([name, field]) => ({
        name,
        type: field.type,
        ...(field.unit === undefined ? {} : { unit: field.unit }),
        ...(field.description === undefined
          ? {}
          : { description: field.description }),
        signals: [dataset.signal],
      })),
      supportedAggregations: [
        "count",
        "sum",
        "avg",
        "min",
        "max",
        "percentile",
        "distinctCount",
        "rate",
        "histogram",
      ],
    })),
  };
}
