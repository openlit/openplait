import {
  validateQueryResult,
  type DataFrame,
  type QueryResult,
  type SemanticQuery,
} from "@openplait/core";

import { RuntimeError } from "./errors.js";
import { createExecutionPlan } from "./planner.js";
import { DatasourceRegistry } from "./registry.js";
import { executeTransformations } from "./transforms.js";
import type {
  OpenPlaitRuntimeOptions,
  PlannedQuery,
  RuntimeExecutionRequest,
  RuntimeExecutionResponse,
  RuntimeQueryMetadata,
} from "./types.js";

interface QueryExecution {
  frames: DataFrame[];
  metadata: RuntimeQueryMetadata;
  warnings: string[];
}

function clone<T>(value: T): T {
  return structuredClone(value);
}

function cacheKey(query: PlannedQuery, variables: RuntimeExecutionRequest["variables"]): string {
  return JSON.stringify({
    datasource: query.datasource,
    query: query.executable,
    variables: variables ?? {},
  });
}

function namedFrames(result: QueryResult, queryName: string): DataFrame[] {
  if (result.frames.length === 1) {
    const frame = clone(result.frames[0]!);
    frame.name ??= queryName;
    return [frame];
  }
  return result.frames.map((source, index) => {
    const frame = clone(source);
    frame.name = `${queryName}:${frame.name ?? index}`;
    return frame;
  });
}

function ensureUniqueFrameNames(frames: DataFrame[]): void {
  const names = new Set<string>();
  for (const frame of frames) {
    if (!frame.name) continue;
    if (names.has(frame.name)) {
      throw new RuntimeError("DUPLICATE_FRAME_NAME", `Frame name '${frame.name}' is duplicated.`);
    }
    names.add(frame.name);
  }
}

export class OpenPlaitRuntime {
  readonly datasources: DatasourceRegistry;
  private readonly options: OpenPlaitRuntimeOptions;

  constructor(
    datasources: DatasourceRegistry = new DatasourceRegistry(),
    options: OpenPlaitRuntimeOptions = {},
  ) {
    this.datasources = datasources;
    this.options = options;
  }

  async execute(request: RuntimeExecutionRequest): Promise<RuntimeExecutionResponse> {
    const now = this.options.now ?? Date.now;
    const started = now();
    const controller = new AbortController();
    let timedOut = false;
    const abort = (): void => controller.abort(request.abortSignal?.reason);
    if (request.abortSignal?.aborted) abort();
    else request.abortSignal?.addEventListener("abort", abort, { once: true });
    const timeoutMs = request.timeoutMs ?? this.options.defaultTimeoutMs;
    const timeout = timeoutMs === undefined
      ? undefined
      : setTimeout(() => {
          timedOut = true;
          controller.abort(new DOMException("Runtime execution timed out.", "TimeoutError"));
        }, timeoutMs);

    try {
      if (controller.signal.aborted) throw new RuntimeError("CANCELLED", "Runtime execution was cancelled.");
      if (request.queries.length === 0) {
        throw new RuntimeError("QUERY_INVALID", "Runtime execution requires at least one query.", {
          path: "/queries",
        });
      }
      const plan = await createExecutionPlan(
        this.datasources,
        request.queries,
        request.transformations ?? [],
      );
      await this.options.hooks?.onPlan?.(clone(plan));

      const executions = await Promise.all(
        plan.queries.map(async (query): Promise<QueryExecution> => {
          if (controller.signal.aborted) {
            throw new RuntimeError(timedOut ? "TIMEOUT" : "CANCELLED", "Runtime execution was aborted.");
          }
          const handle = this.datasources.resolve(query.original.spec.datasource);
          const queryStarted = now();
          const key = cacheKey(query, request.variables);
          let result = await this.options.cache?.get(key);
          let cache: RuntimeQueryMetadata["cache"] = this.options.cache ? "miss" : "bypass";
          await this.options.hooks?.onQueryStart?.(clone(query));
          if (result) {
            cache = "hit";
          } else {
            const context = {
              audit: request.audit,
              ...(request.variables ? { variables: request.variables } : {}),
              abortSignal: controller.signal,
              ...(timeoutMs === undefined ? {} : { timeoutMs }),
              queryId: `${request.audit.requestId}:${query.original.metadata.name}`,
            };
            const executable = query.executable.spec.mode === "semantic"
              ? await handle.compile(query.executable as SemanticQuery, {
                  ...(request.variables ? { variables: request.variables } : {}),
                })
              : query.executable;
            result = await handle.execute(executable, context);
          }
          const validation = validateQueryResult(result);
          if (!validation.valid) {
            throw new RuntimeError("RESULT_INVALID", `Adapter returned an invalid result for '${query.original.metadata.name}'.`, {
              details: { errors: validation.errors },
            });
          }
          if (cache === "miss") await this.options.cache?.set(key, clone(result));
          await this.options.hooks?.onQueryComplete?.(clone(query), clone(result));
          return {
            frames: namedFrames(result, query.original.metadata.name),
            warnings: result.metadata?.warnings ?? [],
            metadata: {
              query: query.original.metadata.name,
              datasource: query.datasource.name,
              adapter: query.datasource.adapter,
              adapterVersion: query.datasource.version,
              cache,
              executionTimeMs: Math.max(0, now() - queryStarted),
              rowsReturned: result.frames.reduce((sum, frame) => sum + frame.length, 0),
              ...(result.metadata?.rowsRead === undefined ? {} : { rowsRead: result.metadata.rowsRead }),
            },
          };
        }),
      );

      const frames = executions.flatMap((execution) => execution.frames);
      ensureUniqueFrameNames(frames);
      const warnings = executions.flatMap((execution) => execution.warnings);
      const cacheStates = executions.map(({ metadata }) => metadata.cache);
      let result: QueryResult = {
        frames,
        metadata: {
          datasource: executions.length === 1 ? executions[0]!.metadata.datasource : "multiple",
          executionTimeMs: Math.max(0, now() - started),
          rowsRead: executions.reduce((sum, execution) => sum + (execution.metadata.rowsRead ?? 0), 0),
          rowsReturned: frames.reduce((sum, frame) => sum + frame.length, 0),
          cache: cacheStates.every((state) => state === "hit")
            ? "hit"
            : cacheStates.some((state) => state === "miss")
              ? "miss"
              : "bypass",
          warnings,
        },
      };
      result = executeTransformations(result, plan.runtimeTransformations, request.variables);
      if (result.metadata) {
        result.metadata.executionTimeMs = Math.max(0, now() - started);
        result.metadata.rowsReturned = result.frames.reduce((sum, frame) => sum + frame.length, 0);
      }
      const validation = validateQueryResult(result);
      if (!validation.valid) {
        throw new RuntimeError("RESULT_INVALID", "Runtime transformations produced an invalid result.", {
          details: { errors: validation.errors },
        });
      }

      return {
        result,
        plan,
        deferredTransformations: clone(plan.clientTransformations),
        metadata: {
          executionTimeMs: Math.max(0, now() - started),
          queryCount: plan.queries.length,
          sourceTransformations: plan.sourceTransformations.map(({ kind }) => kind),
          runtimeTransformations: plan.runtimeTransformations.map(({ kind }) => kind),
          clientTransformations: plan.clientTransformations.map(({ kind }) => kind),
          queries: executions.map(({ metadata }) => metadata),
          warnings,
        },
      };
    } catch (error) {
      controller.abort(error);
      await this.options.hooks?.onError?.(error);
      if (timedOut) throw new RuntimeError("TIMEOUT", "Runtime execution timed out.", { cause: error });
      if (request.abortSignal?.aborted) {
        throw new RuntimeError("CANCELLED", "Runtime execution was cancelled.", { cause: error });
      }
      throw error;
    } finally {
      if (timeout !== undefined) clearTimeout(timeout);
      request.abortSignal?.removeEventListener("abort", abort);
    }
  }
}
