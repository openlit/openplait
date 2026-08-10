import { OPENPLAIT_API_VERSION, type NativeQuery, type SemanticQuery } from "@openplait/core";
import { describe, expect, it, vi } from "vitest";
import { LOKI_DATASET, LokiAdapter, validateLokiConfig } from "../src/index.js";

const range = { from: "2026-08-05T00:00:00.000Z", to: "2026-08-05T01:00:00.000Z" };
const semantic = (): SemanticQuery => ({ apiVersion: OPENPLAIT_API_VERSION, kind: "Query", metadata: { name: "logs" }, spec: { mode: "semantic", datasource: { kind: "LokiDatasource", name: "primary" }, input: { signal: "logs", entity: LOKI_DATASET }, timeRange: { field: "timestamp", ...range }, select: [{ field: "timestamp" }, { field: "body" }], where: { and: [{ field: "service.name", operator: "equals", value: "checkout" }, { field: "body", operator: "contains", value: "failed" }] }, orderBy: [{ field: "timestamp", direction: "desc" }], limit: 25 } });

describe("Loki adapter", () => {
  it("validates and compiles bounded semantic LogQL", async () => {
    expect(validateLokiConfig({ url: "http://localhost:3100" }).valid).toBe(true);
    expect(validateLokiConfig({ url: "ftp://localhost" }).valid).toBe(false);
    const adapter = new LokiAdapter({ url: "http://localhost:3100" });
    const compiled = await adapter.compile(semantic(), {});
    expect(compiled.compiled).toMatchObject({ logql: '{service_name="checkout"} |= "failed"', limit: 25, direction: "backward" });
    expect(() => { compiled.compiled.logql = "{}"; }).toThrow(TypeError);
  });

  it("executes native LogQL and normalizes stream rows", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ status: "success", data: { resultType: "streams", result: [{ stream: { service_name: "checkout", trace_id: "abc" }, values: [["1785888000000000000", "failed"]] }] } }), { status: 200, headers: { "Content-Type": "application/json" } }));
    const adapter = new LokiAdapter({ url: "http://localhost:3100", tenantId: "tenant-a", allowNativeQueries: true }, { fetch: fetchMock, now: () => 10 });
    const query: NativeQuery = { apiVersion: OPENPLAIT_API_VERSION, kind: "Query", metadata: { name: "native-logs" }, spec: { mode: "native", datasource: { kind: "LokiDatasource", name: "primary" }, native: { language: "logql", statement: "{service_name=\"checkout\"}" }, extensions: { "io.openplait.loki": { timeRange: range, limit: 10 } } } };
    const result = await adapter.execute(query, { audit: { requestId: "loki-test-1" } });
    const [url, init] = fetchMock.mock.calls[0] as [URL, RequestInit];
    expect(url.pathname).toBe("/loki/api/v1/query_range");
    expect(url.searchParams.get("query")).toBe('{service_name="checkout"}');
    expect(new Headers(init.headers).get("X-Scope-OrgID")).toBe("tenant-a");
    expect(result.frames[0]?.fields.find((field) => field.name === "body")?.values).toEqual(["failed"]);
  });
});
