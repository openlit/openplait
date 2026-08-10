import { LokiAdapter } from "@openplait/adapter-loki";
import { PrometheusAdapter } from "@openplait/adapter-prometheus";
import { OPENPLAIT_API_VERSION, type NativeQuery } from "@openplait/core";
import { describe, expect, it, vi } from "vitest";
import { DatasourceRegistry, OpenPlaitRuntime } from "../src/index.js";

const timeRange = { from: "2026-08-05T00:00:00.000Z", to: "2026-08-05T01:00:00.000Z" };
function query(name: string, datasource: string, kind: string, language: string, statement: string, extension: string): NativeQuery {
  return { apiVersion: OPENPLAIT_API_VERSION, kind: "Query", metadata: { name }, spec: { mode: "native", datasource: { kind, name: datasource }, native: { language, statement }, extensions: { [extension]: { timeRange, step: "1m", limit: 10 } } } };
}

describe("Loki and Prometheus runtime integration", () => {
  it("routes each query only to its named datasource", async () => {
    const lokiFetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({ status: "success", data: { resultType: "streams", result: [] } }), { status: 200 }));
    const prometheusFetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({ status: "success", data: { resultType: "matrix", result: [] } }), { status: 200 }));
    const registry = new DatasourceRegistry()
      .register({ name: "logs", kind: "LokiDatasource", config: { url: "http://loki:3100" }, adapter: new LokiAdapter({ url: "http://loki:3100", allowNativeQueries: true }, { fetch: lokiFetch }) })
      .register({ name: "metrics", kind: "PrometheusDatasource", config: { url: "http://prometheus:9090" }, adapter: new PrometheusAdapter({ url: "http://prometheus:9090", allowNativeQueries: true }, { fetch: prometheusFetch }) });
    const runtime = new OpenPlaitRuntime(registry);
    const response = await runtime.execute({ queries: [
      query("errors", "logs", "LokiDatasource", "logql", "{level=\"error\"}", "io.openplait.loki"),
      query("up", "metrics", "PrometheusDatasource", "promql", "up", "io.openplait.prometheus"),
    ], audit: { requestId: "runtime-http-signals-1" } });
    expect(lokiFetch).toHaveBeenCalledOnce();
    expect(prometheusFetch).toHaveBeenCalledOnce();
    expect(response.metadata.queries.map((item) => item.adapter)).toEqual(["loki", "prometheus"]);
  });
});
