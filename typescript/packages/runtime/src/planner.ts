import {
  validateQuery,
  validateTransformationPipeline,
  type BooleanExpression,
  type Query,
  type SemanticQuery,
  type Transformation,
} from "@openplait/core";
import type { QueryOperation } from "@openplait/adapter-sdk";

import { RuntimeError } from "./errors.js";
import type { DatasourceRegistry } from "./registry.js";
import type { ExecutionPlan, PlannedQuery, RuntimeDatasourceHandle } from "./types.js";

function clone<T>(value: T): T {
  return structuredClone(value);
}

function operationFor(transformation: Transformation): QueryOperation | undefined {
  if (transformation.kind === "FilterRows") return "filter";
  if (transformation.kind === "Sort") return "order";
  if (transformation.kind === "Limit") return "limit";
  return undefined;
}

function outputFieldMap(query: SemanticQuery): Map<string, string> | undefined {
  if (query.spec.groupBy || query.spec.select.some((item) => "aggregate" in item || "expression" in item)) {
    return undefined;
  }
  return new Map(
    query.spec.select
      .filter((item): item is { field: string; as?: string } => "field" in item)
      .map((item) => [item.as ?? item.field, item.field]),
  );
}

function mapCondition(
  condition: BooleanExpression,
  fields: Map<string, string>,
): BooleanExpression | undefined {
  if ("and" in condition) {
    const children = condition.and.map((child) => mapCondition(child, fields));
    return children.every((child) => child !== undefined)
      ? { and: children as BooleanExpression[] }
      : undefined;
  }
  if ("or" in condition) {
    const children = condition.or.map((child) => mapCondition(child, fields));
    return children.every((child) => child !== undefined)
      ? { or: children as BooleanExpression[] }
      : undefined;
  }
  if ("not" in condition) {
    const child = mapCondition(condition.not, fields);
    return child ? { not: child } : undefined;
  }
  const field = fields.get(condition.field);
  return field ? { ...condition, field } : undefined;
}

function pushIntoQuery(query: Query, transformation: Transformation): Query | undefined {
  if (query.spec.mode !== "semantic") return undefined;
  const result = clone(query) as SemanticQuery;
  if (transformation.kind === "Limit") {
    if (transformation.spec.count === 0) return undefined;
    result.spec.limit = Math.min(result.spec.limit ?? Number.MAX_SAFE_INTEGER, transformation.spec.count);
    return result;
  }
  if (transformation.kind === "Sort") {
    result.spec.orderBy = clone(
      Array.isArray(transformation.spec.by) ? transformation.spec.by : [transformation.spec.by],
    );
    return result;
  }
  if (transformation.kind === "FilterRows") {
    const fields = outputFieldMap(result);
    if (!fields) return undefined;
    const condition = mapCondition(transformation.spec.condition, fields);
    if (!condition) return undefined;
    result.spec.where = result.spec.where ? { and: [result.spec.where, condition] } : condition;
    return result;
  }
  return undefined;
}

async function planQueries(
  queries: Query[],
  registry: DatasourceRegistry,
): Promise<{ planned: PlannedQuery[]; handles: RuntimeDatasourceHandle[] }> {
  const names = new Set<string>();
  const planned: PlannedQuery[] = [];
  const handles: RuntimeDatasourceHandle[] = [];
  for (const [index, query] of queries.entries()) {
    const validation = validateQuery(query);
    if (!validation.valid) {
      throw new RuntimeError("QUERY_INVALID", `Query ${index} is invalid.`, {
        path: `/queries/${index}`,
        details: { errors: validation.errors },
      });
    }
    if (names.has(query.metadata.name)) {
      throw new RuntimeError("DUPLICATE_QUERY_NAME", `Query name '${query.metadata.name}' is duplicated.`);
    }
    names.add(query.metadata.name);
    const handle = registry.resolve(query.spec.datasource);
    handles.push(handle);
    planned.push({
      original: clone(query),
      executable: clone(query),
      datasource: {
        name: handle.name,
        kind: handle.kind,
        scope: handle.scope,
        adapter: handle.manifest.name,
        version: handle.manifest.version,
      },
    });
  }
  return { planned, handles };
}

export async function createExecutionPlan(
  registry: DatasourceRegistry,
  queries: Query[],
  transformations: Transformation[] = [],
): Promise<ExecutionPlan> {
  const transformationValidation = validateTransformationPipeline({
    apiVersion: "openplait.io/v1alpha1",
    kind: "TransformationPipeline",
    metadata: { name: "runtime-pipeline" },
    spec: { transformations },
  });
  if (!transformationValidation.valid) {
    throw new RuntimeError("TRANSFORM_FAILED", "Transformation pipeline is invalid.", {
      path: "/transformations",
      details: { errors: transformationValidation.errors },
    });
  }
  const { planned, handles } = await planQueries(queries, registry);
  const capabilities = await Promise.all(handles.map((handle) => handle.getCapabilities()));
  for (const [index, capability] of capabilities.entries()) {
    const query = planned[index]!.executable;
    if (query.spec.mode === "semantic" && !capability.signals.includes(query.spec.input.signal)) {
      throw new RuntimeError(
        "CAPABILITY_UNSUPPORTED",
        `Datasource '${planned[index]!.datasource.name}' does not support '${query.spec.input.signal}'.`,
        { path: `/queries/${index}/spec/input/signal` },
      );
    }
    if (
      query.spec.mode === "native" &&
      !(capability.nativeQueryLanguages ?? []).includes(query.spec.native.language)
    ) {
      throw new RuntimeError(
        "CAPABILITY_UNSUPPORTED",
        `Datasource '${planned[index]!.datasource.name}' does not enable '${query.spec.native.language}' native queries.`,
        { path: `/queries/${index}/spec/native/language` },
      );
    }
  }
  const sourceTransformations: Transformation[] = [];
  const runtimeTransformations: Transformation[] = [];
  const clientTransformations: Transformation[] = [];
  let stage: "source" | "runtime" | "client" = "source";
  let pushedSort = false;
  let pushedLimit = false;

  for (const [index, transformation] of transformations.entries()) {
    const preference = transformation.execution?.preference ?? "auto";
    if (preference === "client") {
      stage = "client";
      clientTransformations.push(clone(transformation));
      continue;
    }
    if (stage === "client") {
      throw new RuntimeError(
        "TRANSFORM_STAGE_INVALID",
        "Runtime/source transformations cannot follow a client transformation.",
        { path: `/transformations/${index}/execution/preference` },
      );
    }

    const operation = operationFor(transformation);
    const preservesOrder =
      (transformation.kind === "FilterRows" && !pushedLimit) ||
      (transformation.kind === "Sort" && !pushedSort && !pushedLimit) ||
      transformation.kind === "Limit";
    const canAttemptSource =
      stage === "source" &&
      operation !== undefined &&
      preservesOrder &&
      capabilities.every(({ operations }) => operations.includes(operation));
    const rewritten = canAttemptSource
      ? planned.map(({ executable }) => pushIntoQuery(executable, transformation))
      : [];
    const canPush = canAttemptSource && rewritten.every((query) => query !== undefined);

    if (preference === "source" && !canPush) {
      throw new RuntimeError(
        "TRANSFORM_PUSHDOWN_UNSUPPORTED",
        `Transformation '${transformation.kind}' cannot be safely pushed to every datasource.`,
        { path: `/transformations/${index}` },
      );
    }
    if ((preference === "source" || preference === "auto") && canPush) {
      for (const [queryIndex, query] of rewritten.entries()) {
        planned[queryIndex]!.executable = query!;
      }
      sourceTransformations.push(clone(transformation));
      if (transformation.kind === "Sort") pushedSort = true;
      if (transformation.kind === "Limit") pushedLimit = true;
      continue;
    }

    stage = "runtime";
    runtimeTransformations.push(clone(transformation));
  }

  return { queries: planned, sourceTransformations, runtimeTransformations, clientTransformations };
}
