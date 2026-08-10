import type { CompiledField, CompiledQuery } from "@openplait/adapter-sdk";
import type { SemanticQuery } from "@openplait/core";
import { AdapterError } from "@openplait/adapter-sdk";

import { JAEGER_DATASET_NAME, JAEGER_TRACE_FIELDS } from "./datasets.js";
import type { JaegerCompiledRequest } from "./types.js";

function resolveVariable(value: unknown, variables?: Record<string, unknown>): unknown {
  if (typeof value !== "string") return value;
  const match = value.match(/^\$\{([^}]+)\}$/);
  if (!match?.[1]) return value;
  return variables?.[match[1]] ?? value;
}

function asIsoMs(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  const date = new Date(String(value || ""));
  if (Number.isNaN(date.getTime())) {
    throw new AdapterError("INVALID_PARAMETER", "Jaeger time range bounds are invalid.");
  }
  return date.getTime();
}

function extractServiceFilter(
  where: SemanticQuery["spec"]["where"],
  variables?: Record<string, unknown>,
): { service?: string; operation?: string; tags: Record<string, string> } {
  const tags: Record<string, string> = {};
  let service: string | undefined;
  let operation: string | undefined;

  const visit = (node: unknown): void => {
    if (!node || typeof node !== "object") return;
    const record = node as Record<string, unknown>;
    if (Array.isArray(record.and)) {
      for (const child of record.and) visit(child);
      return;
    }
    if (typeof record.field !== "string") return;
    const field = record.field;
    const operator = String(record.operator || "equals");
    if (operator !== "equals") return;
    const raw = resolveVariable(record.value, variables);
    const value = String(raw ?? "");
    if (!value) return;
    if (field === "service.name") service = value;
    else if (field === "span.name" || field === "operation.name") operation = value;
    else if (field.startsWith("attributes.") || field.startsWith("resource.")) {
      tags[field.replace(/^(attributes|resource)\./, "")] = value;
    } else if (!(field in JAEGER_TRACE_FIELDS)) {
      tags[field] = value;
    }
  };

  visit(where);
  return {
    tags,
    ...(service ? { service } : {}),
    ...(operation ? { operation } : {}),
  };
}

export function compileJaegerQuery(
  query: SemanticQuery,
  context: { variables?: Record<string, unknown>; maxResultRows?: number } = {},
): CompiledQuery<JaegerCompiledRequest> {
  const entity = query.spec.input?.entity || JAEGER_DATASET_NAME;
  if (entity !== JAEGER_DATASET_NAME) {
    throw new AdapterError("DATASET_NOT_FOUND", `Unknown Jaeger entity "${entity}".`);
  }
  if (query.spec.input?.signal && query.spec.input.signal !== "traces") {
    throw new AdapterError("UNSUPPORTED_OPERATION", "Jaeger adapter only supports traces.");
  }

  const from = asIsoMs(resolveVariable(query.spec.timeRange?.from, context.variables));
  const to = asIsoMs(resolveVariable(query.spec.timeRange?.to, context.variables));
  const { service, operation, tags } = extractServiceFilter(query.spec.where, context.variables);
  if (!service) {
    throw new AdapterError(
      "QUERY_VALIDATION_FAILED",
      'Jaeger search requires a service.name equals filter (Jaeger Query API is service-scoped).',
    );
  }

  const limit = Math.min(
    Math.max(1, Number(query.spec.limit) || 100),
    context.maxResultRows || 1_000,
  );

  const selected: CompiledField[] = (query.spec.select || [
    { field: "trace.id" },
    { field: "span.id" },
    { field: "timestamp" },
    { field: "duration" },
    { field: "service.name" },
    { field: "span.name" },
  ])
    .filter((item): item is { field: string; as?: string } => "field" in item)
    .map((item) => {
      const name = item.as || item.field;
      const meta = JAEGER_TRACE_FIELDS[item.field];
      return {
        name,
        source: meta?.resultKey || item.field,
        type: meta?.type || "string",
      };
    });

  return {
    kind: "CompiledQuery",
    language: "openplait-semantic",
    compiled: {
      endpoint: "search",
      service,
      startMs: from,
      endMs: to,
      limit,
      ...(operation ? { operation } : {}),
      ...(Object.keys(tags).length ? { tags } : {}),
    },
    parameters: {},
    fields: selected,
    source: {
      resourceName: query.metadata.name,
      dataset: JAEGER_DATASET_NAME,
    },
    warnings: [],
  };
}
