import { OPENPLAIT_API_VERSION, type SemanticQuery } from "@openplait/core";
import { describe, expect, it, vi } from "vitest";

import {
  JAEGER_CAPABILITIES,
  JAEGER_DATASET_NAME,
  JaegerAdapter,
  flattenJaegerTraces,
  validateJaegerConfig,
} from "../src/index.js";

function jsonResponse(value: unknown, init?: ResponseInit): Response {
  return new Response(JSON.stringify(value), {
    status: 200,
    headers: { "Content-Type": "application/json" },
    ...init,
  });
}

function semanticQuery(service = "checkout"): SemanticQuery {
  return {
    apiVersion: OPENPLAIT_API_VERSION,
    kind: "Query",
    metadata: { name: "jaeger-traces" },
    spec: {
      mode: "semantic",
      datasource: { kind: "JaegerDatasource", name: "primary" },
      input: { signal: "traces", entity: JAEGER_DATASET_NAME },
      timeRange: {
        field: "timestamp",
        from: "2026-08-05T00:00:00.000Z",
        to: "2026-08-05T01:00:00.000Z",
      },
      select: [
        { field: "trace.id" },
        { field: "service.name" },
        { field: "span.name" },
      ],
      where: {
        and: [{ field: "service.name", operator: "equals", value: service }],
      },
      limit: 25,
    },
  };
}

describe("Jaeger adapter", () => {
  it("validates connection settings", () => {
    expect(validateJaegerConfig({ url: "https://jaeger.example.com" }).valid).toBe(true);
    expect(validateJaegerConfig({ url: "ftp://jaeger.example.com" })).toMatchObject({
      valid: false,
    });
    expect(
      validateJaegerConfig({ url: "https://jaeger.example.com", username: "user" }),
    ).toMatchObject({ valid: false });
  });

  it("reports trace-only capabilities", async () => {
    const adapter = new JaegerAdapter({ url: "http://localhost:16686" });
    expect(await adapter.getCapabilities({ url: "http://localhost:16686" })).toMatchObject({
      ...JAEGER_CAPABILITIES,
      nativeQueryLanguages: [],
    });
  });

  it("lists services and searches traces", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith("/api/services")) {
        return jsonResponse({ data: ["checkout", "payments"] });
      }
      if (url.includes("/api/traces?")) {
        return jsonResponse({
          data: [
            {
              traceID: "abc",
              processes: { p1: { serviceName: "checkout", tags: [] } },
              spans: [
                {
                  traceID: "abc",
                  spanID: "span1",
                  operationName: "POST /pay",
                  processID: "p1",
                  startTime: 1_700_000_000_000_000,
                  duration: 12_000,
                  tags: [{ key: "gen_ai.system", value: "openai" }],
                  logs: [],
                  references: [],
                },
              ],
            },
          ],
        });
      }
      return jsonResponse({ data: [] }, { status: 404 });
    });

    const adapter = new JaegerAdapter(
      { url: "http://localhost:16686" },
      { fetch: fetchMock as unknown as typeof fetch },
    );

    await expect(adapter.listServices()).resolves.toEqual(["checkout", "payments"]);

    const compiled = await adapter.compile(semanticQuery());
    expect(compiled.compiled.service).toBe("checkout");

    const result = await adapter.execute(compiled, {
      audit: { requestId: "req-1" },
    });
    expect(result.frames[0]?.fields.find((f) => f.name === "service.name")?.values).toEqual([
      "checkout",
    ]);
  });

  it("normalizes spans with events from Jaeger logs", () => {
    const spans = flattenJaegerTraces([
      {
        traceID: "t1",
        processes: { p1: { serviceName: "api" } },
        spans: [
          {
            traceID: "t1",
            spanID: "s1",
            operationName: "handler",
            processID: "p1",
            startTime: 1_700_000_000_000_000,
            duration: 5_000,
            tags: [{ key: "error", value: "true" }],
            logs: [
              {
                timestamp: 1_700_000_000_000_000,
                fields: [
                  { key: "event", value: "exception" },
                  { key: "message", value: "boom" },
                ],
              },
            ],
          },
        ],
      },
    ]);
    expect(spans).toHaveLength(1);
    expect(spans[0]?.statusCode).toBe("STATUS_CODE_ERROR");
    expect(spans[0]?.events[0]?.name).toBe("exception");
  });

  it("requires service.name for semantic compile", async () => {
    const adapter = new JaegerAdapter({ url: "http://localhost:16686" });
    const query = semanticQuery();
    query.spec.where = { and: [] };
    await expect(adapter.compile(query)).rejects.toThrow(/service\.name/);
  });
});
