import type { SemanticQuery } from "@openplait/core";
import { OPENPLAIT_API_VERSION } from "@openplait/core";
import { AdapterError } from "@openplait/adapter-sdk";
import { describe, expect, it } from "vitest";

import { OPENLIT_CLICKHOUSE_DATASETS, compileClickHouseQuery } from "../src/index.js";

const config = {
  url: "http://localhost:8123",
  maxResultRows: 500,
  maxTimeRangeMs: 24 * 60 * 60 * 1_000,
} as const;

function query(overrides: Partial<SemanticQuery["spec"]> = {}): SemanticQuery {
  return {
    apiVersion: OPENPLAIT_API_VERSION,
    kind: "Query",
    metadata: { name: "latency-by-model" },
    spec: {
      mode: "semantic",
      datasource: { kind: "ClickHouseDatasource", name: "primary" },
      input: { signal: "traces", entity: "otel.spans" },
      timeRange: {
        field: "timestamp",
        from: "${__from}",
        to: "${__to}",
      },
      select: [
        { field: "gen_ai.request.model", as: "model" },
        {
          aggregate: { function: "avg", field: "duration" },
          as: "average_latency",
        },
      ],
      groupBy: [{ field: "gen_ai.request.model" }],
      orderBy: [{ field: "average_latency", direction: "desc" }],
      limit: 20,
      ...overrides,
    },
  };
}

const context = {
  variables: {
    __from: "2026-08-05T00:00:00.000Z",
    __to: "2026-08-05T01:00:00.000Z",
  },
};

describe("ClickHouse semantic compiler", () => {
  it("compiles selections, aggregation, grouping, ordering, and bound time values", () => {
    const compiled = compileClickHouseQuery(query(), config, context);

    expect(compiled.compiled.statement).toMatchInlineSnapshot(`
      "SELECT
        SpanAttributes['gen_ai.request.model'] AS \`model\`,
        avg(Duration) AS \`average_latency\`
      FROM \`otel_traces\`
      WHERE Timestamp BETWEEN {op_0:DateTime64(9)} AND {op_1:DateTime64(9)}
      GROUP BY SpanAttributes['gen_ai.request.model']
      ORDER BY \`average_latency\` DESC
      LIMIT 20"
    `);
    expect(compiled.parameters).toEqual({
      op_0: "2026-08-05T00:00:00.000Z",
      op_1: "2026-08-05T01:00:00.000Z",
    });
    expect(compiled.compiled.statement).not.toContain("2026-08-05");
    expect(compiled.fields).toEqual([
      {
        name: "model",
        type: "string",
        source: "gen_ai.request.model",
      },
      { name: "average_latency", type: "number", unit: "ns" },
    ]);
  });

  it("binds filter parameters and injects an immutable tenant predicate", () => {
    const compiled = compileClickHouseQuery(
      query({
        parameters: { service: "checkout" },
        where: {
          and: [
            {
              field: "service.name",
              operator: "equals",
              value: "${service}",
            },
            {
              field: "status.code",
              operator: "in",
              value: ["Ok", "Unset"],
            },
          ],
        },
      }),
      {
        ...config,
        tenant: { field: "service.namespace", value: "tenant-a" },
      },
      context,
    );

    expect(compiled.compiled.statement).toContain(
      "ResourceAttributes['service.namespace'] = {op_2:String}",
    );
    expect(compiled.compiled.statement).toContain("ServiceName = {op_3:String}");
    expect(compiled.compiled.statement).toContain(
      "StatusCode IN {op_4:Array(String)}",
    );
    expect(compiled.parameters).toEqual({
      op_0: context.variables.__from,
      op_1: context.variables.__to,
      op_2: "tenant-a",
      op_3: "checkout",
      op_4: ["Ok", "Unset"],
    });
  });

  it("compiles time buckets and percentiles", () => {
    const compiled = compileClickHouseQuery(
      query({
        select: [
          { field: "timestamp", as: "time" },
          {
            aggregate: {
              function: "percentile",
              field: "duration",
              percentile: 95,
            },
            as: "p95",
          },
        ],
        groupBy: [
          { timeBucket: { field: "timestamp", interval: "5m", as: "time" } },
        ],
        orderBy: [{ field: "time", direction: "asc" }],
      }),
      config,
      context,
    );

    expect(compiled.compiled.statement).toContain(
      "toStartOfInterval(Timestamp, INTERVAL 5 MINUTE) AS `time`",
    );
    expect(compiled.compiled.statement).toContain("quantile(0.95)(Duration) AS `p95`");
  });

  it("adds dataset default filters", () => {
    const costs = query({
      input: { signal: "traces", entity: "openlit.costs" },
      select: [
        {
          aggregate: { function: "sum", field: "gen_ai.usage.cost" },
          as: "cost",
        },
      ],
    });
    delete costs.spec.groupBy;
    delete costs.spec.orderBy;

    const compiled = compileClickHouseQuery(
      costs,
      { ...config, datasets: [...OPENLIT_CLICKHOUSE_DATASETS] },
      context,
    );

    expect(compiled.compiled.statement).toContain(
      "toFloat64OrZero(SpanAttributes['gen_ai.usage.cost']) > {op_2:Float64}",
    );
    expect(compiled.parameters.op_2).toBe(0);
  });

  it("rejects unknown fields before generating SQL", () => {
    expect(() =>
      compileClickHouseQuery(
        query({
          select: [{ field: "secret.column" }],
          groupBy: [{ field: "secret.column" }],
        }),
        config,
        context,
      ),
    ).toThrowError(expect.objectContaining({ code: "FIELD_NOT_FOUND" }));
  });

  it("rejects time ranges beyond policy", () => {
    try {
      compileClickHouseQuery(query(), config, {
        variables: {
          __from: "2026-08-01T00:00:00.000Z",
          __to: "2026-08-05T00:00:00.000Z",
        },
      });
      throw new Error("Expected compilation to fail.");
    } catch (error) {
      expect(error).toBeInstanceOf(AdapterError);
      expect((error as AdapterError).code).toBe("TIME_RANGE_TOO_LARGE");
    }
  });

  it("rejects joins until the portable join model can express both sides", () => {
    expect(() =>
      compileClickHouseQuery(
        query({
          joins: [
            {
              entity: "otel.logs",
              on: { field: "trace.id", operator: "equals", value: "placeholder" },
            },
          ],
        }),
        config,
        context,
      ),
    ).toThrowError(expect.objectContaining({ code: "UNSUPPORTED_OPERATION" }));
  });

  it("rejects numeric aggregates over string fields", () => {
    expect(() =>
      compileClickHouseQuery(
        query({
          select: [
            {
              aggregate: { function: "sum", field: "service.name" },
              as: "invalid",
            },
          ],
        }),
        config,
        context,
      ),
    ).toThrowError(expect.objectContaining({ code: "UNSUPPORTED_OPERATION" }));
  });

  it("rejects ungrouped selected fields alongside aggregates", () => {
    expect(() =>
      compileClickHouseQuery(
        query({ groupBy: [{ field: "service.name" }] }),
        config,
        context,
      ),
    ).toThrowError(expect.objectContaining({ code: "QUERY_VALIDATION_FAILED" }));
  });
});
