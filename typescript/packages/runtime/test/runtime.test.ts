import type {
  NativeQuery,
  QueryResult,
  SemanticQuery,
  Transformation,
} from "@openplait/core";
import { OPENPLAIT_API_VERSION } from "@openplait/core";
import type {
  AdapterManifest,
  AdapterValidationResult,
  CompileContext,
  CompiledQuery,
  DatasourceAdapter,
  DatasourceCapabilities,
  ExecutionContext,
} from "@openplait/adapter-sdk";
import { describe, expect, it, vi } from "vitest";

import {
  DatasourceRegistry,
  OpenPlaitRuntime,
  RuntimeError,
  createExecutionPlan,
  type RuntimeCache,
} from "../src/index.js";

interface TestConfig {
  enabled: boolean;
}

interface TestCompiled {
  query: SemanticQuery;
}

class TestAdapter implements DatasourceAdapter<TestConfig, TestCompiled> {
  readonly manifest: AdapterManifest = {
    name: "test",
    displayName: "Test",
    version: "1.0.0",
    queryLanguages: ["openplait-semantic"],
    signals: ["tabular"],
  };
  readonly compileCalls: SemanticQuery[] = [];
  readonly executeCalls: string[] = [];
  constructor(
    private readonly results: Record<string, QueryResult>,
    private readonly slow = false,
  ) {}

  validateConfig(config: TestConfig): AdapterValidationResult<TestConfig> {
    return config.enabled
      ? { valid: true, value: config, errors: [] }
      : { valid: false, errors: [{ code: "disabled", path: "/enabled", message: "Disabled" }] };
  }

  async getCapabilities(): Promise<DatasourceCapabilities> {
    return {
      signals: ["tabular"],
      operations: ["select", "filter", "order", "limit"],
      joins: { local: false, crossDatasource: false },
    };
  }

  async compile(
    query: SemanticQuery,
    _context: CompileContext,
  ): Promise<CompiledQuery<TestCompiled>> {
    this.compileCalls.push(structuredClone(query));
    return {
      kind: "CompiledQuery",
      language: "test",
      compiled: { query },
      parameters: {},
      fields: [],
      source: { resourceName: query.metadata.name, dataset: query.spec.input.entity },
      warnings: [],
    };
  }

  async execute(
    query: CompiledQuery<TestCompiled> | NativeQuery,
    context: ExecutionContext,
  ): Promise<QueryResult> {
    const name = query.kind === "CompiledQuery" ? query.compiled.query.metadata.name : query.metadata.name;
    this.executeCalls.push(name);
    if (this.slow) {
      await new Promise<never>((_resolve, reject) => {
        const cancel = (): void => reject(new DOMException("Cancelled", "AbortError"));
        if (context.abortSignal?.aborted) cancel();
        else context.abortSignal?.addEventListener("abort", cancel, { once: true });
      });
    }
    const result = this.results[name];
    if (!result) throw new Error(`No result for ${name}`);
    return structuredClone(result);
  }
}

function query(name: string, datasource = "primary"): SemanticQuery {
  return {
    apiVersion: OPENPLAIT_API_VERSION,
    kind: "Query",
    metadata: { name },
    spec: {
      mode: "semantic",
      datasource: { kind: "TestDatasource", name },
      input: { signal: "tabular", entity: `test.${name}` },
      select: [{ field: "service" }, { field: name === "costs" ? "total_cost" : "request_count" }],
    },
  } satisfies SemanticQuery;
}

function registry(adapter: TestAdapter): DatasourceRegistry {
  return new DatasourceRegistry()
    .register({ name: "requests", kind: "TestDatasource", config: { enabled: true }, adapter })
    .register({ name: "costs", kind: "TestDatasource", config: { enabled: true }, adapter });
}

const results: Record<string, QueryResult> = {
  requests: {
    frames: [{
      name: "requests",
      length: 2,
      fields: [
        { name: "service", type: "string", values: ["checkout", "search"] },
        { name: "request_count", type: "number", values: [2, 4] },
      ],
    }],
  },
  costs: {
    frames: [{
      name: "costs",
      length: 2,
      fields: [
        { name: "service", type: "string", values: ["checkout", "search"] },
        { name: "total_cost", type: "number", unit: "currencyUSD", values: [10, 12] },
      ],
    }],
  },
};

describe("runtime planner", () => {
  it("pushes only a safe leading transformation prefix", async () => {
    const adapter = new TestAdapter(results);
    const transformations: Transformation[] = [
      { kind: "Sort", spec: { by: { field: "service", direction: "asc" } } },
      { kind: "CalculateField", spec: { as: "double", expression: { multiply: [{ field: "request_count" }, { value: 2 }] } } },
      { kind: "Limit", spec: { count: 1 } },
      { kind: "SelectFields", spec: { fields: ["service", "double"] }, execution: { preference: "client" } },
    ];

    const plan = await createExecutionPlan(registry(adapter), [query("requests")], transformations);

    expect(plan.sourceTransformations.map(({ kind }) => kind)).toEqual(["Sort"]);
    expect(plan.runtimeTransformations.map(({ kind }) => kind)).toEqual(["CalculateField", "Limit"]);
    expect(plan.clientTransformations.map(({ kind }) => kind)).toEqual(["SelectFields"]);
    expect(plan.queries[0]?.executable.spec).toEqual(
      expect.objectContaining({ orderBy: [{ field: "service", direction: "asc" }] }),
    );
  });

  it("rejects mandatory pushdown for a runtime-only transform", async () => {
    await expect(
      createExecutionPlan(registry(new TestAdapter(results)), [query("requests")], [
        {
          kind: "CalculateField",
          spec: { as: "double", expression: { multiply: [{ field: "request_count" }, { value: 2 }] } },
          execution: { preference: "source" },
        },
      ]),
    ).rejects.toMatchObject({ code: "TRANSFORM_PUSHDOWN_UNSUPPORTED" });
  });

  it("does not reorder limit and sort semantics during pushdown", async () => {
    const plan = await createExecutionPlan(registry(new TestAdapter(results)), [query("requests")], [
      { kind: "Limit", spec: { count: 1 } },
      { kind: "Sort", spec: { by: { field: "service", direction: "asc" } } },
    ]);

    expect(plan.sourceTransformations.map(({ kind }) => kind)).toEqual(["Limit"]);
    expect(plan.runtimeTransformations.map(({ kind }) => kind)).toEqual(["Sort"]);
  });
});

describe("runtime execution", () => {
  it("executes multiple datasource queries and joins normalized frames", async () => {
    const adapter = new TestAdapter(results);
    const runtime = new OpenPlaitRuntime(registry(adapter));
    const response = await runtime.execute({
      queries: [query("requests"), query("costs")],
      transformations: [
        { kind: "JoinFrames", spec: { left: "requests", right: "costs", on: ["service"], as: "service_metrics" } },
        {
          kind: "CalculateField",
          spec: {
            as: "cost_per_request",
            expression: { divide: [{ field: "total_cost" }, { field: "request_count" }] },
            type: "number",
          },
        },
        { kind: "Sort", spec: { by: { field: "cost_per_request", direction: "desc" } } },
      ],
      audit: { requestId: "request-1" },
    });

    expect(response.result.frames).toEqual([
      expect.objectContaining({
        name: "service_metrics",
        length: 2,
        fields: expect.arrayContaining([
          expect.objectContaining({ name: "service", values: ["checkout", "search"] }),
          expect.objectContaining({ name: "cost_per_request", values: [5, 3] }),
        ]),
      }),
    ]);
    expect(response.metadata.queryCount).toBe(2);
    expect(response.metadata.runtimeTransformations).toEqual(["JoinFrames", "CalculateField", "Sort"]);
  });

  it("uses cache and emits lifecycle hooks", async () => {
    const adapter = new TestAdapter(results);
    const values = new Map<string, QueryResult>();
    const cache: RuntimeCache = {
      get: async (key) => values.get(key),
      set: async (key, value) => { values.set(key, value); },
    };
    const onQueryStart = vi.fn();
    const onQueryComplete = vi.fn();
    const runtime = new OpenPlaitRuntime(registry(adapter), {
      cache,
      hooks: { onQueryStart, onQueryComplete },
    });
    const request = { queries: [query("requests")], audit: { requestId: "cache-1" } };

    const first = await runtime.execute(request);
    const second = await runtime.execute(request);

    expect(first.metadata.queries[0]?.cache).toBe("miss");
    expect(second.metadata.queries[0]?.cache).toBe("hit");
    expect(adapter.executeCalls).toEqual(["requests"]);
    expect(onQueryStart).toHaveBeenCalledTimes(2);
    expect(onQueryComplete).toHaveBeenCalledTimes(2);
  });

  it("propagates cancellation through the runtime", async () => {
    const adapter = new TestAdapter(results, true);
    const runtime = new OpenPlaitRuntime(registry(adapter));
    const controller = new AbortController();
    const pending = runtime.execute({
      queries: [query("requests")],
      audit: { requestId: "cancel-1" },
      abortSignal: controller.signal,
    });
    controller.abort();

    await expect(pending).rejects.toMatchObject({ code: "CANCELLED" });
  });

  it("rejects invalid datasource registration", () => {
    expect(() =>
      new DatasourceRegistry().register({
        name: "disabled",
        kind: "TestDatasource",
        config: { enabled: false },
        adapter: new TestAdapter(results),
      }),
    ).toThrow(RuntimeError);
  });
});
