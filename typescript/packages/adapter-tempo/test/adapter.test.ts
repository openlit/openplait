import {
  OPENPLAIT_API_VERSION,
  validateQueryResult,
  type NativeQuery,
  type SemanticQuery,
} from "@openplait/core";
import { describe, expect, it, vi } from "vitest";

import {
  TEMPO_CAPABILITIES,
  TEMPO_DATASET_NAME,
  TempoAdapter,
  compileNativeTempoQuery,
  validateTempoConfig,
} from "../src/index.js";

const variables = {
  __from: "2026-08-05T00:00:00.000Z",
  __to: "2026-08-05T01:00:00.000Z",
};

function semanticQuery(): SemanticQuery {
  return {
    apiVersion: OPENPLAIT_API_VERSION,
    kind: "Query",
    metadata: { name: "tempo-traces" },
    spec: {
      mode: "semantic",
      datasource: { kind: "TempoDatasource", name: "primary" },
      input: { signal: "traces", entity: TEMPO_DATASET_NAME },
      timeRange: { field: "timestamp", from: "${__from}", to: "${__to}" },
      select: [
        { field: "trace.id" },
        { field: "timestamp" },
        { field: "duration" },
        { field: "root.service.name", as: "service" },
      ],
      where: {
        and: [
          { field: "service.name", operator: "equals", value: "checkout\"api" },
          { field: "status.code", operator: "equals", value: "error" },
        ],
      },
      orderBy: [{ field: "timestamp", direction: "desc" }],
      limit: 25,
    },
  };
}

function nativeQuery(): NativeQuery {
  return {
    apiVersion: OPENPLAIT_API_VERSION,
    kind: "Query",
    metadata: { name: "native-tempo" },
    spec: {
      mode: "native",
      datasource: { kind: "TempoDatasource", name: "primary" },
      native: { language: "traceql", statement: "{ span:duration > 500ms }" },
      extensions: {
        "io.openplait.tempo": {
          timeRange: { from: variables.__from, to: variables.__to },
          limit: 10,
          spansPerSpanSet: 20,
        },
      },
    },
  };
}

function jsonResponse(value: unknown, init?: ResponseInit): Response {
  return new Response(JSON.stringify(value), {
    status: 200,
    headers: { "Content-Type": "application/json" },
    ...init,
  });
}

describe("Tempo adapter", () => {
  it("validates connection and authentication settings", () => {
    expect(validateTempoConfig({ url: "https://tempo.example.com" }).valid).toBe(true);
    expect(validateTempoConfig({ url: "ftp://tempo.example.com" })).toMatchObject({ valid: false });
    expect(validateTempoConfig({ url: "https://tempo.example.com", username: "user" })).toMatchObject({ valid: false });
    expect(validateTempoConfig({
      url: "https://tempo.example.com",
      username: "user",
      password: "secret",
      bearerToken: "token",
    })).toMatchObject({ valid: false });
    expect(validateTempoConfig({ url: "https://tempo.example.com", tempoVersion: "latest" })).toMatchObject({ valid: false });
  });

  it("reports trace-only capabilities and schema", async () => {
    const adapter = new TempoAdapter({ url: "http://localhost:3200" });
    expect(await adapter.getCapabilities({ url: "http://localhost:3200" })).toEqual({
      ...TEMPO_CAPABILITIES,
      nativeQueryLanguages: [],
      limits: {},
      extensions: {
        "io.openplait.tempo": {
          features: {
            traceql: null,
            mostRecent: null,
            traceqlMetrics: null,
            tagSearchV2: null,
          },
          limits: {},
        },
      },
    });
    const schema = await adapter.discoverSchema({});
    expect(schema.datasets[0]).toMatchObject({
      name: TEMPO_DATASET_NAME,
      signal: "traces",
    });
    expect(schema.datasets[0]?.fields.map(({ name }) => name)).toContain("trace.id");
    expect(schema.datasets[0]?.fields.map(({ name }) => name)).not.toContain("span.name");
  });

  it("compiles safe TraceQL and rejects filter-only projections", async () => {
    const adapter = new TempoAdapter({ url: "http://localhost:3200", tempoVersion: "2.8.0" });
    const compiled = await adapter.compile(semanticQuery(), { variables });
    expect(compiled.compiled).toEqual({
      endpoint: "search",
      traceql: '{ (resource.service.name = "checkout\\"api" && span:status = error) } with (most_recent=true)',
      start: Date.parse(variables.__from) / 1_000,
      end: Date.parse(variables.__to) / 1_000,
      limit: 25,
      spansPerSpanSet: 100,
    });
    expect(() => {
      compiled.compiled.traceql = "{ true }";
    }).toThrow(TypeError);

    const invalid = semanticQuery();
    invalid.spec.select = [{ field: "span.name" }];
    await expect(adapter.compile(invalid, { variables })).rejects.toMatchObject({
      code: "UNSUPPORTED_OPERATION",
      path: "/spec/select/0/field",
    });

    const unordered = semanticQuery();
    delete unordered.spec.where;
    delete unordered.spec.orderBy;
    await expect(adapter.compile(unordered, { variables })).resolves.toMatchObject({
      compiled: { traceql: "{ }" },
    });
  });

  it("does not emit experimental search hints for an unknown or older Tempo", async () => {
    const query = semanticQuery();
    const unknown = new TempoAdapter({ url: "http://localhost:3200" });
    const older = new TempoAdapter({ url: "http://localhost:3200", tempoVersion: "2.7.1" });
    await expect(unknown.compile(query, { variables })).resolves.toMatchObject({
      compiled: { traceql: expect.not.stringContaining("most_recent") },
    });
    await expect(older.compile(query, { variables })).resolves.toMatchObject({
      compiled: { traceql: expect.not.stringContaining("most_recent") },
    });
  });

  it("inspects build information and derives version-sensitive capabilities", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ version: "2.8.2" }));
    const adapter = new TempoAdapter({ url: "http://localhost:3200" }, { fetch: fetchMock });
    await expect(adapter.inspectServer()).resolves.toMatchObject({
      version: "2.8.2",
      features: { traceql: true, mostRecent: true, tagSearchV2: true },
    });
    expect((fetchMock.mock.calls[0]?.[0] as URL).pathname).toBe("/api/status/buildinfo");
  });

  it("supports configured application-neutral attribute filters", async () => {
    const query = semanticQuery();
    query.spec.where = {
      and: [
        { field: "deployment.environment", operator: "in", value: ["prod", "staging"] },
        { not: { field: "http.route", operator: "contains", value: "/internal" } },
      ],
    };
    const adapter = new TempoAdapter({
      url: "http://localhost:3200",
      attributeFields: {
        "deployment.environment": {
          scope: "resource",
          attribute: "deployment.environment.name",
          type: "string",
        },
        "http.route": { scope: "span", attribute: "http.route", type: "string" },
      },
    });
    const compiled = await adapter.compile(query, { variables });
    expect(compiled.compiled.traceql).toBe(
      '{ ((resource.deployment.environment.name = "prod" || resource.deployment.environment.name = "staging") && span.http.route !~ ".*/internal.*") }',
    );
  });

  it("executes search with tenant/auth headers and normalizes trace summaries", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({
      traces: [{
        traceID: "0123456789abcdef0123456789abcdef",
        rootServiceName: "checkout",
        rootTraceName: "POST /checkout",
        startTimeUnixNano: "1785888000000000000",
        durationMs: 42.5,
        spanSet: { matched: 3, spans: [] },
      }],
      metrics: { inspectedTraces: 120 },
    }));
    const clock = vi.fn().mockReturnValueOnce(1_000).mockReturnValueOnce(1_015);
    const adapter = new TempoAdapter({
      url: "https://tempo.example.com/prefix",
      tenantId: "tenant-a",
      bearerToken: "token",
    }, { fetch: fetchMock, now: clock });
    const compiled = await adapter.compile(semanticQuery(), { variables });
    const result = await adapter.execute(compiled, { audit: { requestId: "request-1" } });

    const [url, init] = fetchMock.mock.calls[0] as [URL, RequestInit];
    expect(url.pathname).toBe("/prefix/api/search");
    expect(url.searchParams.get("q")).toBe(compiled.compiled.traceql);
    expect(url.searchParams.get("limit")).toBe("25");
    expect(new Headers(init.headers).get("X-Scope-OrgID")).toBe("tenant-a");
    expect(new Headers(init.headers).get("Authorization")).toBe("Bearer token");
    expect(new Headers(init.headers).get("X-Request-ID")).toBe("request-1");
    expect(result.frames[0]).toEqual({
      name: "tempo-traces",
      length: 1,
      fields: [
        { name: "trace.id", type: "trace", values: ["0123456789abcdef0123456789abcdef"] },
        { name: "timestamp", type: "time", values: ["2026-08-05T00:00:00.000Z"] },
        { name: "duration", type: "duration", unit: "ms", values: [42.5] },
        { name: "service", type: "string", values: ["checkout"] },
      ],
    });
    expect(result.metadata).toMatchObject({ rowsRead: 120, rowsReturned: 1, executionTimeMs: 15 });
    expect(validateQueryResult(result).valid).toBe(true);
  });

  it("gates native TraceQL and applies native limits", async () => {
    expect(compileNativeTempoQuery(nativeQuery(), {
      url: "http://localhost:3200",
      maxResultRows: 50,
      maxSpansPerSpanSet: 25,
    })).toMatchObject({ limit: 10, spansPerSpanSet: 20 });

    const adapter = new TempoAdapter(
      { url: "http://localhost:3200" },
      { fetch: vi.fn() },
    );
    await expect(adapter.execute(nativeQuery(), {
      audit: { requestId: "native-1" },
    })).rejects.toMatchObject({ code: "NATIVE_QUERY_REJECTED" });
  });

  it("does not widen an exact-limit fractional range during epoch-second conversion", () => {
    const maxTimeRangeMs = 30 * 24 * 60 * 60 * 1_000;
    const query = nativeQuery();
    const to = new Date("2026-08-06T11:24:17.901Z");
    const from = new Date(to.getTime() - maxTimeRangeMs);
    const extension = query.spec.extensions?.["io.openplait.tempo"] as {
      timeRange: { from: string; to: string };
    };
    extension.timeRange = { from: from.toISOString(), to: to.toISOString() };

    const compiled = compileNativeTempoQuery(query, {
      url: "http://localhost:3200",
      maxTimeRangeMs,
    });

    expect(compiled.end - compiled.start).toBeLessThanOrEqual(
      maxTimeRangeMs / 1_000,
    );
  });

  it("fetches OTLP trace details and emits one row per span", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({
      resourceSpans: [{
        resource: { attributes: [{ key: "service.name", value: { stringValue: "payments" } }] },
        scopeSpans: [{ spans: [{
          traceId: "0123456789abcdef0123456789abcdef",
          spanId: "0123456789abcdef",
          parentSpanId: "",
          name: "charge",
          kind: 2,
          startTimeUnixNano: "1785888000000000000",
          endTimeUnixNano: "1785888000025000000",
          status: { code: 1 },
          attributes: [{ key: "http.method", value: { stringValue: "POST" } }],
          events: [],
        }] }],
      }],
    }));
    const adapter = new TempoAdapter({ url: "http://localhost:3200" }, { fetch: fetchMock });
    const result = await adapter.getTrace("0123456789abcdef0123456789abcdef", {
      audit: { requestId: "trace-1" },
    });
    expect(result.frames[0]?.length).toBe(1);
    const values = Object.fromEntries(result.frames[0]?.fields.map((field) => [field.name, field.values[0]]) ?? []);
    expect(values).toMatchObject({
      duration: 25,
      "span.name": "charge",
      "span.kind": "server",
      "status.code": "ok",
      "service.name": "payments",
      "span.attributes": { "http.method": "POST" },
    });
  });

  it("normalizes OTLP base64 trace, span, and parent IDs to lowercase hex", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({
      resourceSpans: [{ scopeSpans: [{ spans: [{
        traceId: Buffer.from("0123456789abcdef0123456789abcdef", "hex").toString("base64"),
        spanId: Buffer.from("0123456789abcdef", "hex").toString("base64"),
        parentSpanId: Buffer.from("fedcba9876543210", "hex").toString("base64"),
      }] }] }],
    }));
    const adapter = new TempoAdapter({ url: "http://localhost:3200" }, { fetch: fetchMock });
    const result = await adapter.getTrace("0123456789abcdef0123456789abcdef", { audit: { requestId: "trace-base64" } });
    const values = Object.fromEntries(result.frames[0]?.fields.map((field) => [field.name, field.values[0]]) ?? []);
    expect(values).toMatchObject({
      "trace.id": "0123456789abcdef0123456789abcdef",
      "span.id": "0123456789abcdef",
      "span.parent_id": "fedcba9876543210",
    });
  });

  it("classifies Tempo HTTP errors without exposing credentials", async () => {
    const adapter = new TempoAdapter(
      { url: "http://localhost:3200", bearerToken: "secret" },
      { fetch: vi.fn().mockResolvedValue(new Response("bad query", { status: 400 })) },
    );
    const compiled = await adapter.compile(semanticQuery(), { variables });
    await expect(adapter.execute(compiled, {
      audit: { requestId: "request-2" },
    })).rejects.toMatchObject({
      code: "EXECUTION_FAILED",
      details: {
        status: 400,
        body: "bad query",
        endpoint: "/api/search",
        queryParameterNames: ["end", "limit", "q", "spss", "start"],
        requestId: "request-2",
      },
    });
  });

  it("normalizes v2 tag discovery responses", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ scopes: [{ name: "resource", tags: ["service.name", "cluster"] }] }))
      .mockResolvedValueOnce(jsonResponse({ tagValues: [{ type: "string", value: "checkout" }] }));
    const adapter = new TempoAdapter({ url: "http://localhost:3200" }, { fetch: fetchMock });
    await expect(adapter.discoverTags("resource", {})).resolves.toEqual(["service.name", "cluster"]);
    await expect(adapter.discoverTagValues("resource.service.name", {})).resolves.toEqual(["checkout"]);
  });

  it("executes and normalizes TraceQL metrics through the adapter", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({
      series: [{
        labels: [{ key: "service.name", value: { stringValue: "checkout" } }],
        samples: [{ timestampMs: 1785888000000, value: 12 }],
      }],
    }));
    const adapter = new TempoAdapter({ url: "http://localhost:3200" }, { fetch: fetchMock });
    const result = await adapter.queryMetrics({
      query: "{} | count_over_time()",
      from: variables.__from,
      to: variables.__to,
      step: "1m",
    }, { audit: { requestId: "metrics-1" } });
    const url = fetchMock.mock.calls[0]?.[0] as URL;
    expect(url.pathname).toBe("/api/metrics/query_range");
    expect(url.searchParams.get("q")).toBe("{} | count_over_time()");
    expect(result.frames[0]).toMatchObject({
      length: 1,
      fields: [
        { name: "timestamp", values: ["2026-08-05T00:00:00.000Z"] },
        { name: "value", values: [12] },
        { name: "labels", values: [{ "service.name": "checkout" }] },
      ],
    });
  });

  it("falls back to legacy tag discovery when an unpinned Tempo rejects v2", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response("not found", { status: 404 }))
      .mockResolvedValueOnce(jsonResponse({ tagNames: ["service.name"] }))
      .mockResolvedValueOnce(new Response("not found", { status: 404 }))
      .mockResolvedValueOnce(jsonResponse({ tagValues: ["checkout"] }));
    const adapter = new TempoAdapter({ url: "http://localhost:3200" }, { fetch: fetchMock });
    await expect(adapter.discoverTags("resource", {})).resolves.toEqual(["service.name"]);
    await expect(adapter.discoverTagValues("resource.service.name", {})).resolves.toEqual(["checkout"]);
    expect((fetchMock.mock.calls[1]?.[0] as URL).pathname).toBe("/api/search/tags");
    expect((fetchMock.mock.calls[3]?.[0] as URL).pathname).toBe("/api/search/tag/resource.service.name/values");
  });
});
