import { LokiAdapter } from "@openplait/adapter-loki";
import { PrometheusAdapter } from "@openplait/adapter-prometheus";
import { OPENPLAIT_API_VERSION, type NativeQuery } from "@openplait/core";
import { describe, expect, it } from "vitest";

const run = process.env.OPENPLAIT_RUN_DOCKER_INTEGRATION === "1" ? describe : describe.skip;
const now = Date.now();
const timeRange = {
  from: new Date(now - 10 * 60_000).toISOString(),
  to: new Date(now + 60_000).toISOString(),
};

function nativeQuery(
  name: string,
  kind: string,
  language: string,
  statement: string,
  extension: string,
  extensionValue: Record<string, unknown>,
): NativeQuery {
  return {
    apiVersion: OPENPLAIT_API_VERSION,
    kind: "Query",
    metadata: { name },
    spec: {
      mode: "native",
      datasource: { kind, name: "local" },
      native: { language, statement },
      extensions: { [extension]: extensionValue },
    },
  };
}

run("local Loki and Prometheus containers", () => {
  it("queries seeded Loki logs through OpenPlait", async () => {
    const adapter = new LokiAdapter({
      url: "http://localhost:3100",
      allowNativeQueries: true,
    });
    const result = await adapter.execute(
      nativeQuery(
        "local-loki",
        "LokiDatasource",
        "logql",
        '{service_name="openplait-integration"}',
        "io.openplait.loki",
        { timeRange, limit: 100 },
      ),
      { audit: { requestId: "local-loki-integration" } },
    );
    expect(result.frames[0]?.fields.find((field) => field.name === "body")?.values)
      .toContain("OpenPlait Loki integration log");
  });

  it("queries Prometheus self-scrape metrics through OpenPlait", async () => {
    const adapter = new PrometheusAdapter({
      url: "http://localhost:9090",
      allowNativeQueries: true,
    });
    const result = await adapter.execute(
      nativeQuery(
        "local-prometheus",
        "PrometheusDatasource",
        "promql",
        'up{job="prometheus"}',
        "io.openplait.prometheus",
        { timeRange, step: "5s" },
      ),
      { audit: { requestId: "local-prometheus-integration" } },
    );
    expect(result.frames[0]?.fields.find((field) => field.name === "value")?.values)
      .toContain(1);
  });
});
