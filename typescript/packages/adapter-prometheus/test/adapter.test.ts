import { OPENPLAIT_API_VERSION, type NativeQuery, type SemanticQuery } from "@openplait/core";
import { describe, expect, it, vi } from "vitest";
import { PROMETHEUS_DATASET, PrometheusAdapter, validatePrometheusConfig } from "../src/index.js";

const range = { from: "2026-08-05T00:00:00.000Z", to: "2026-08-05T01:00:00.000Z" };
const semantic = (): SemanticQuery => ({ apiVersion: OPENPLAIT_API_VERSION, kind: "Query", metadata: { name: "metrics" }, spec: { mode: "semantic", datasource: { kind: "PrometheusDatasource", name: "primary" }, input: { signal: "metrics", entity: PROMETHEUS_DATASET }, timeRange: { field: "timestamp", ...range }, select: [{ aggregate: { function: "rate", field: "value" }, as: "rate" }], where: { and: [{ field: "metric.name", operator: "equals", value: "http_requests_total" }, { field: "service.name", operator: "equals", value: "checkout" }] } } });

describe("Prometheus adapter", () => {
  it("validates and compiles bounded semantic PromQL", async () => {
    expect(validatePrometheusConfig({ url: "http://localhost:9090", defaultStep: "1m" }).valid).toBe(true);
    expect(validatePrometheusConfig({ url: "http://localhost:9090", defaultStep: "soon" }).valid).toBe(false);
    const adapter = new PrometheusAdapter({ url: "http://localhost:9090", defaultStep: "1m" });
    const compiled = await adapter.compile(semantic(), {});
    expect(compiled.compiled).toMatchObject({ promql: 'rate({__name__="http_requests_total",service_name="checkout"}[1m])', step: "1m" });
  });

  it("executes native PromQL and normalizes matrix samples", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ status: "success", data: { resultType: "matrix", result: [{ metric: { __name__: "up", job: "api" }, values: [[1785888000, "1"], [1785888060, "0"]] }] } }), { status: 200, headers: { "Content-Type": "application/json" } }));
    const adapter = new PrometheusAdapter({ url: "http://localhost:9090", allowNativeQueries: true }, { fetch: fetchMock, now: () => 10 });
    const query: NativeQuery = { apiVersion: OPENPLAIT_API_VERSION, kind: "Query", metadata: { name: "native-metrics" }, spec: { mode: "native", datasource: { kind: "PrometheusDatasource", name: "primary" }, native: { language: "promql", statement: "up" }, extensions: { "io.openplait.prometheus": { timeRange: range, step: "1m" } } } };
    const result = await adapter.execute(query, { audit: { requestId: "prom-test-1" } });
    const [url] = fetchMock.mock.calls[0] as [URL, RequestInit];
    expect(url.pathname).toBe("/api/v1/query_range");
    expect(url.searchParams.get("query")).toBe("up");
    expect(result.frames[0]?.fields.find((field) => field.name === "value")?.values).toEqual([1, 0]);
  });
});
