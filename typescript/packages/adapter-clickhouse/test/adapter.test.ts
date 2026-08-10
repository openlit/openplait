import type { ClickHouseClient } from "@clickhouse/client";
import {
  OPENPLAIT_API_VERSION,
  validateQueryResult,
  type NativeQuery,
  type SemanticQuery,
} from "@openplait/core";
import { AdapterError } from "@openplait/adapter-sdk";
import { describe, expect, it, vi } from "vitest";

import {
  CLICKHOUSE_CAPABILITIES,
  ClickHouseAdapter,
  OPENLIT_CLICKHOUSE_DATASETS,
  compileNativeQuery,
  normalizeClickHouseResponse,
  validateClickHouseConfig,
  validateNativeStatement,
} from "../src/index.js";

function semanticQuery(): SemanticQuery {
  return {
    apiVersion: OPENPLAIT_API_VERSION,
    kind: "Query",
    metadata: { name: "requests" },
    spec: {
      mode: "semantic",
      datasource: { kind: "ClickHouseDatasource", name: "primary" },
      input: { signal: "traces", entity: "otel.spans" },
      timeRange: {
        field: "timestamp",
        from: "${__from}",
        to: "${__to}",
      },
      select: [{ aggregate: { function: "count" }, as: "requests" }],
    },
  };
}

function nativeQuery(statement = "SELECT {value:UInt64} AS value"): NativeQuery {
  return {
    apiVersion: OPENPLAIT_API_VERSION,
    kind: "Query",
    metadata: { name: "native-value" },
    spec: {
      mode: "native",
      datasource: { kind: "ClickHouseDatasource", name: "primary" },
      native: { language: "sql", statement },
      parameters: { value: "${value}" },
    },
  };
}

function mockClient(response: unknown): {
  client: ClickHouseClient;
  query: ReturnType<typeof vi.fn>;
  close: ReturnType<typeof vi.fn>;
} {
  const query = vi.fn().mockResolvedValue({
    query_id: "request-1",
    response_headers: {},
    json: vi.fn().mockResolvedValue(response),
  });
  const close = vi.fn().mockResolvedValue(undefined);
  return {
    client: { query, close } as unknown as ClickHouseClient,
    query,
    close,
  };
}

const variables = {
  __from: "2026-08-05T00:00:00.000Z",
  __to: "2026-08-05T01:00:00.000Z",
};

describe("ClickHouse adapter", () => {
  it("declares honest capabilities and discovers the generic OpenTelemetry schema", async () => {
    const mock = mockClient({ data: [] });
    const adapter = new ClickHouseAdapter(
      { url: "http://localhost:8123" },
      { client: mock.client },
    );

    const capabilities = await adapter.getCapabilities({
      url: "http://localhost:8123",
    });
    expect(capabilities).toEqual({
      ...CLICKHOUSE_CAPABILITIES,
      nativeQueryLanguages: [],
    });
    expect(CLICKHOUSE_CAPABILITIES.joins.local).toBe(false);
    const schema = await adapter.discoverSchema({});
    expect(schema.datasets.map(({ name }) => name)).toEqual([
      "otel.spans",
      "otel.logs",
      "otel.metrics.gauge",
      "otel.metrics.sum",
      "otel.metrics.histogram",
    ]);
  });

  it("accepts application-specific dataset presets without coupling adapter defaults", async () => {
    const mock = mockClient({ data: [] });
    const adapter = new ClickHouseAdapter(
      { url: "http://localhost:8123", datasets: [...OPENLIT_CLICKHOUSE_DATASETS] },
      { client: mock.client },
    );

    const schema = await adapter.discoverSchema({});
    expect(schema.datasets.map(({ name }) => name)).toEqual(
      expect.arrayContaining(["otel.spans", "openlit.evaluations", "openlit.exceptions", "openlit.costs"]),
    );
  });

  it("executes adapter-compiled SQL with read-only limits and normalizes frames", async () => {
    const mock = mockClient({
      data: [{ requests: "42" }],
      meta: [{ name: "requests", type: "UInt64" }],
      statistics: { elapsed: 0.01, rows_read: 5_000, bytes_read: 100_000 },
      rows: 1,
    });
    const clock = vi.fn().mockReturnValueOnce(1_000).mockReturnValueOnce(1_025);
    const adapter = new ClickHouseAdapter(
      {
        url: "http://localhost:8123",
        queryTimeoutMs: 5_000,
        maxResultRows: 100,
        maxRowsToRead: 50_000,
      },
      { client: mock.client, now: clock },
    );
    const compiled = await adapter.compile(semanticQuery(), { variables });
    expect(() => {
      compiled.compiled.statement = "SELECT * FROM system.users";
    }).toThrow(TypeError);
    const result = await adapter.execute(compiled, {
      audit: { requestId: "request-1", actorId: "user-1" },
    });

    expect(mock.query).toHaveBeenCalledWith(
      expect.objectContaining({
        format: "JSON",
        query_id: "request-1",
        query_params: {
          op_0: variables.__from,
          op_1: variables.__to,
        },
        clickhouse_settings: expect.objectContaining({
          readonly: "1",
          max_execution_time: 5,
          max_result_rows: "100",
          max_rows_to_read: "50000",
          result_overflow_mode: "throw",
          read_overflow_mode: "throw",
        }),
      }),
    );
    expect(result).toEqual({
      frames: [
        {
          name: "requests",
          length: 1,
          fields: [{ name: "requests", type: "number", values: [42] }],
        },
      ],
      metadata: {
        datasource: "clickhouse",
        adapterVersion: "0.1.0-alpha.0",
        executionTimeMs: 25,
        rowsRead: 5_000,
        rowsReturned: 1,
        cache: "bypass",
        warnings: [],
      },
    });
    expect(validateQueryResult(result).valid).toBe(true);
  });

  it("rejects forged compiled query envelopes", async () => {
    const mock = mockClient({ data: [] });
    const adapter = new ClickHouseAdapter(
      { url: "http://localhost:8123", allowNativeQueries: true },
      { client: mock.client },
    );

    await expect(
      adapter.execute(
        {
          kind: "CompiledQuery",
          language: "sql",
          compiled: { statement: "SELECT * FROM system.users" },
          parameters: {},
          fields: [],
          source: { resourceName: "forged", dataset: "system.users" },
          warnings: [],
        },
        { audit: { requestId: "request-1" } },
      ),
    ).rejects.toMatchObject({ code: "QUERY_VALIDATION_FAILED" });
    expect(mock.query).not.toHaveBeenCalled();
  });

  it("executes native SQL only with explicitly referenced bound parameters", async () => {
    const mock = mockClient({
      data: [{ value: 7 }],
      meta: [{ name: "value", type: "UInt64" }],
      rows: 1,
    });
    const adapter = new ClickHouseAdapter(
      { url: "http://localhost:8123", allowNativeQueries: true },
      { client: mock.client },
    );

    const result = await adapter.execute(nativeQuery(), {
      audit: { requestId: "native-1" },
      variables: { value: 7 },
    });

    expect(mock.query).toHaveBeenCalledWith(
      expect.objectContaining({
        query: "SELECT {value:UInt64} AS value",
        query_params: { value: 7 },
        query_id: "native-1",
      }),
    );
    expect(result.frames[0]?.fields[0]).toEqual({
      name: "value",
      type: "number",
      values: [7],
    });
  });

  it("classifies caller cancellation", async () => {
    const query = vi.fn().mockImplementation(
      ({ abort_signal }: { abort_signal: AbortSignal }) =>
        Promise.reject(
          abort_signal.aborted
            ? new DOMException("Cancelled", "AbortError")
            : new Error("Expected pre-aborted signal"),
        ),
    );
    const client = { query, close: vi.fn() } as unknown as ClickHouseClient;
    const adapter = new ClickHouseAdapter(
      { url: "http://localhost:8123" },
      { client },
    );
    const compiled = await adapter.compile(semanticQuery(), { variables });
    const controller = new AbortController();
    controller.abort();

    await expect(
      adapter.execute(compiled, {
        audit: { requestId: "cancel-1" },
        abortSignal: controller.signal,
      }),
    ).rejects.toMatchObject({ code: "ABORTED" });
  });

  it("classifies adapter timeouts", async () => {
    const query = vi.fn().mockImplementation(
      ({ abort_signal }: { abort_signal: AbortSignal }) =>
        new Promise((_resolve, reject) => {
          abort_signal.addEventListener(
            "abort",
            () => reject(new DOMException("Timed out", "AbortError")),
            { once: true },
          );
        }),
    );
    const client = { query, close: vi.fn() } as unknown as ClickHouseClient;
    const adapter = new ClickHouseAdapter(
      { url: "http://localhost:8123", queryTimeoutMs: 5 },
      { client },
    );
    const compiled = await adapter.compile(semanticQuery(), { variables });

    await expect(
      adapter.execute(compiled, {
        audit: { requestId: "timeout-1" },
      }),
    ).rejects.toMatchObject({ code: "TIMEOUT" });
  });

  it("keeps native SQL opt-in", async () => {
    const mock = mockClient({ data: [] });
    const adapter = new ClickHouseAdapter(
      { url: "http://localhost:8123" },
      { client: mock.client },
    );

    await expect(
      adapter.execute(nativeQuery(), {
        audit: { requestId: "native-disabled-1" },
        variables: { value: 1 },
      }),
    ).rejects.toMatchObject({ code: "NATIVE_QUERY_REJECTED" });
    expect(mock.query).not.toHaveBeenCalled();
  });

  it("closes only clients owned by the adapter", async () => {
    const mock = mockClient({ data: [] });
    const adapter = new ClickHouseAdapter(
      { url: "http://localhost:8123" },
      { client: mock.client },
    );
    await adapter.close();
    expect(mock.close).not.toHaveBeenCalled();
  });
});

describe("ClickHouse safety validation", () => {
  it("rejects invalid config and unsafe custom mappings", () => {
    const result = validateClickHouseConfig({
      url: "file:///tmp/clickhouse",
      maxResultRows: 0,
      datasets: [
        {
          name: "unsafe",
          signal: "tabular",
          table: "safe; DROP TABLE users",
          timeField: "timestamp",
          fields: {
            timestamp: {
              expression: "Timestamp -- bypass",
              type: "time",
              clickhouseType: "DateTime64(9)",
            },
          },
        },
      ],
    });

    expect(result.valid).toBe(false);
    if (!result.valid) expect(result.errors.length).toBeGreaterThanOrEqual(4);
  });

  it("rejects writes, separators, and adapter-controlled formats in native SQL", () => {
    for (const statement of [
      "DROP TABLE users",
      "SELECT 1; SELECT 2",
      "WITH x AS (SELECT 1) INSERT INTO users SELECT * FROM x",
      "SELECT 1 FORMAT JSONEachRow",
      "SELECT 1 INTO OUTFILE '/tmp/result'",
    ]) {
      expect(() => validateNativeStatement(statement)).toThrowError(
        expect.objectContaining({ code: "NATIVE_QUERY_REJECTED" }),
      );
    }
    expect(() => validateNativeStatement("SELECT 'DROP; FORMAT' AS harmless")).not.toThrow();
  });

  it("rejects missing and unused native parameters", () => {
    expect(() =>
      compileNativeQuery(nativeQuery(), undefined),
    ).toThrowError(expect.objectContaining({ code: "INVALID_PARAMETER" }));

    const extra = nativeQuery("SELECT 1");
    expect(() => compileNativeQuery(extra, { value: 7 })).toThrowError(
      expect.objectContaining({ code: "INVALID_PARAMETER" }),
    );
  });

  it("normalizes empty native results from ClickHouse metadata", () => {
    const result = normalizeClickHouseResponse(
      {
        data: [],
        meta: [
          { name: "timestamp", type: "DateTime64(9)" },
          { name: "count", type: "UInt64" },
        ],
      },
      undefined,
      { adapterVersion: "test", executionTimeMs: 1 },
    );

    expect(result.frames[0]).toEqual({
      length: 0,
      fields: [
        { name: "timestamp", type: "time", values: [] },
        { name: "count", type: "number", values: [] },
      ],
    });
  });
});
