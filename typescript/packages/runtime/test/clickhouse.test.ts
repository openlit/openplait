import { OPENPLAIT_API_VERSION, type SemanticQuery } from "@openplait/core";
import { ClickHouseAdapter } from "@openplait/adapter-clickhouse";
import { describe, expect, it, vi } from "vitest";

import { DatasourceRegistry, OpenPlaitRuntime } from "../src/index.js";

describe("ClickHouse runtime integration", () => {
  it("pushes safe filters, ordering, and limits into the ClickHouse query", async () => {
    const queryCall = vi.fn().mockResolvedValue({
      query_id: "runtime-1",
      response_headers: {},
      json: vi.fn().mockResolvedValue({
        data: [{ service: "checkout", duration: 125 }],
        meta: [
          { name: "service", type: "String" },
          { name: "duration", type: "UInt64" },
        ],
        rows: 1,
      }),
    });
    const adapter = new ClickHouseAdapter(
      { url: "http://localhost:8123" },
      { client: { query: queryCall, close: vi.fn() } as never },
    );
    const registry = new DatasourceRegistry().register({
      name: "primary",
      kind: "ClickHouseDatasource",
      config: { url: "http://localhost:8123" },
      adapter,
    });
    const runtime = new OpenPlaitRuntime(registry);
    const query: SemanticQuery = {
      apiVersion: OPENPLAIT_API_VERSION,
      kind: "Query",
      metadata: { name: "recent-spans" },
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
          { field: "service.name", as: "service" },
          { field: "duration" },
        ],
      },
    };

    const response = await runtime.execute({
      queries: [query],
      transformations: [
        {
          kind: "FilterRows",
          spec: { condition: { field: "service", operator: "equals", value: "${service}" } },
        },
        { kind: "Sort", spec: { by: { field: "duration", direction: "desc" } } },
        { kind: "Limit", spec: { count: 1 } },
      ],
      variables: {
        __from: "2026-08-05T00:00:00.000Z",
        __to: "2026-08-05T01:00:00.000Z",
        service: "checkout",
      },
      audit: { requestId: "runtime-1" },
    });

    expect(response.metadata.sourceTransformations).toEqual(["FilterRows", "Sort", "Limit"]);
    expect(queryCall).toHaveBeenCalledWith(
      expect.objectContaining({
        query: expect.stringMatching(/ServiceName = \{op_2:String\}[\s\S]*ORDER BY `duration` DESC[\s\S]*LIMIT 1/),
        query_params: expect.objectContaining({ op_2: "checkout" }),
      }),
    );
    expect(response.result.frames[0]?.fields[0]?.values).toEqual(["checkout"]);
  });
});
