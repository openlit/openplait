import {
  TempoAdapter,
  type TempoAdapterConfig,
} from "@openplait/adapter-tempo";
import { OPENPLAIT_API_VERSION, type SemanticQuery } from "@openplait/core";
import { describe, expect, it, vi } from "vitest";

import { DatasourceRegistry, OpenPlaitRuntime } from "../src/index.js";

describe("Tempo runtime integration", () => {
  it("resolves and executes a named Tempo datasource", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      traces: [{
        traceID: "0123456789abcdef0123456789abcdef",
        rootServiceName: "checkout",
        rootTraceName: "POST /checkout",
        startTimeUnixNano: "1785888000000000000",
        durationMs: 42,
      }],
    }), { status: 200, headers: { "Content-Type": "application/json" } }));
    const config: TempoAdapterConfig = {
      url: "http://localhost:3200",
      tenantId: "tenant-a",
      tempoVersion: "2.8.0",
    };
    const registry = new DatasourceRegistry().register({
      name: "traces",
      kind: "TempoDatasource",
      config,
      adapter: new TempoAdapter(config, { fetch: fetchMock }),
    });
    const runtime = new OpenPlaitRuntime(registry);
    const query: SemanticQuery = {
      apiVersion: OPENPLAIT_API_VERSION,
      kind: "Query",
      metadata: { name: "recent-errors" },
      spec: {
        mode: "semantic",
        datasource: { kind: "TempoDatasource", name: "traces" },
        input: { signal: "traces", entity: "tempo.trace_search" },
        timeRange: {
          field: "timestamp",
          from: "${__from}",
          to: "${__to}",
        },
        select: [
          { field: "trace.id" },
          { field: "root.service.name", as: "service" },
          { field: "duration" },
        ],
        where: { field: "status.code", operator: "equals", value: "error" },
        orderBy: [{ field: "timestamp", direction: "desc" }],
        limit: 20,
      },
    };

    const response = await runtime.execute({
      queries: [query],
      variables: {
        __from: "2026-08-05T00:00:00.000Z",
        __to: "2026-08-05T01:00:00.000Z",
      },
      audit: { requestId: "runtime-tempo-1" },
    });

    const [url, init] = fetchMock.mock.calls[0] as [URL, RequestInit];
    expect(url.pathname).toBe("/api/search");
    expect(url.searchParams.get("q")).toBe("{ span:status = error } with (most_recent=true)");
    expect(new Headers(init.headers).get("X-Scope-OrgID")).toBe("tenant-a");
    expect(response.metadata.queries[0]).toMatchObject({
      datasource: "traces",
      adapter: "tempo",
      rowsReturned: 1,
    });
    expect(response.result.frames[0]?.fields[0]?.values).toEqual([
      "0123456789abcdef0123456789abcdef",
    ]);
  });
});
