import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import {
  OPENPLAIT_API_VERSION,
  OpenPlaitValidationError,
  parseDashboard,
  parseAlertRule,
  parseQuery,
  parseResource,
  parseTransformationPipeline,
  serializeDocument,
  validateQuery,
  validateQueryResult,
  validateResource,
  type Dashboard,
  type Query,
} from "../src/index.js";

const examples = fileURLToPath(new URL("../../../../examples/", import.meta.url));

async function fixture(path: string): Promise<string> {
  return readFile(`${examples}${path}`, "utf8");
}

describe("Query validation", () => {
  it("accepts the semantic query example", async () => {
    const query = parseQuery(await fixture("queries/average-model-latency.yaml"));

    expect(query.apiVersion).toBe(OPENPLAIT_API_VERSION);
    expect(query.spec.mode).toBe("semantic");
    expect(query.metadata.name).toBe("average-model-latency");
  });

  it("accepts the bound native query example", async () => {
    const query = parseQuery(await fixture("queries/expensive-traces-native.yaml"));

    expect(query.spec.mode).toBe("native");
    if (query.spec.mode === "native") {
      expect(query.spec.parameters).toEqual({ from: "${__from}", to: "${__to}" });
    }
  });

  it("accepts the portable Tempo trace search example", async () => {
    const query = parseQuery(await fixture("queries/recent-tempo-errors.yaml"));

    expect(query.spec.mode).toBe("semantic");
    if (query.spec.mode === "semantic") {
      expect(query.spec.datasource.kind).toBe("TempoDatasource");
      expect(query.spec.input).toEqual({
        signal: "traces",
        entity: "tempo.trace_search",
      });
    }
  });

  it("rejects duplicate output names", () => {
    const query: Query = {
      apiVersion: OPENPLAIT_API_VERSION,
      kind: "Query",
      metadata: { name: "duplicate-output" },
      spec: {
        mode: "semantic",
        datasource: { kind: "TestDatasource", name: "test" },
        input: { signal: "tabular", entity: "orders" },
        select: [
          { field: "order.id", as: "id" },
          { field: "customer.id", as: "id" },
        ],
      },
    };

    const result = validateQuery(query);

    expect(result.valid).toBe(false);
    if (!result.valid) expect(result.errors[0]?.code).toBe("DUPLICATE_OUTPUT_FIELD");
  });

  it("rejects unknown resource kinds", () => {
    const result = validateResource({
      apiVersion: OPENPLAIT_API_VERSION,
      kind: "Widget",
      metadata: { name: "later" },
      spec: {},
    });

    expect(result.valid).toBe(false);
    if (!result.valid) expect(result.errors[0]?.code).toBe("UNSUPPORTED_KIND");
  });

  it("reports schema paths for malformed resources", () => {
    expect(() =>
      parseResource(`apiVersion: openplait.io/v1alpha1\nkind: Query\nmetadata:\n  name: invalid\nspec:\n  mode: semantic\n`),
    ).toThrow(OpenPlaitValidationError);

    try {
      parseResource(`kind: Query`);
    } catch (error) {
      expect(error).toBeInstanceOf(OpenPlaitValidationError);
      expect((error as OpenPlaitValidationError).errors.length).toBeGreaterThan(0);
    }
  });

  it("round-trips JSON serialization", async () => {
    const query = parseQuery(await fixture("queries/average-model-latency.yaml"));
    const json = serializeDocument(query, "json");

    expect(parseResource(json, "json")).toEqual(query);
    expect(json.endsWith("\n")).toBe(true);
  });
});

describe("Dashboard validation", () => {
  it("accepts and round-trips the generic ClickHouse dashboard example", async () => {
    const dashboard = parseDashboard(await fixture("dashboards/clickhouse-observability.yaml"));

    expect(dashboard.kind).toBe("Dashboard");
    expect(Object.keys(dashboard.spec.panels)).toEqual([
      "request-rate",
      "total-cost",
      "recent-requests",
    ]);
    expect(parseResource(serializeDocument(dashboard))).toEqual(dashboard);
  });

  it("rejects unresolved panel and query references", () => {
    const dashboard: Dashboard = {
      apiVersion: OPENPLAIT_API_VERSION,
      kind: "Dashboard",
      metadata: { name: "broken-dashboard" },
      spec: {
        panels: {
          broken: {
            kind: "Panel",
            spec: {
              plugin: { kind: "StatChart", spec: {} },
              queries: [
                {
                  kind: "OpenPlaitQuery",
                  spec: { queryRef: { $ref: "#/spec/queries/missing" } },
                },
              ],
            },
          },
        },
        layouts: [
          {
            kind: "Grid",
            spec: {
              items: [
                {
                  x: 20,
                  y: 0,
                  width: 8,
                  height: 4,
                  content: { $ref: "#/spec/panels/missing" },
                },
              ],
            },
          },
        ],
        duration: "1h",
      },
    };

    const result = validateResource(dashboard);
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.errors.map(({ code }) => code)).toEqual([
        "REFERENCE_NOT_FOUND",
        "GRID_BOUNDS_EXCEEDED",
        "REFERENCE_NOT_FOUND",
      ]);
    }
  });

  it("applies query semantic validation to embedded dashboard queries", async () => {
    const dashboard = parseDashboard(await fixture("dashboards/clickhouse-observability.yaml"));
    const query = dashboard.spec.queries?.["service-values"];
    if (!query || query.spec.mode !== "semantic") throw new Error("Fixture query is missing.");
    query.spec.select.push({ field: "service.namespace", as: "service" });

    const result = validateResource(dashboard);
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.errors[0]).toEqual(
        expect.objectContaining({
          code: "DUPLICATE_OUTPUT_FIELD",
          path: "/spec/queries/service-values/spec/select/1",
        }),
      );
    }
  });

  it("validates named dashboard datasource bindings", async () => {
    const dashboard = parseDashboard(await fixture("dashboards/clickhouse-observability.yaml"));
    const query = dashboard.spec.queries?.["recent-requests"];
    if (!query) throw new Error("Fixture query is missing.");
    query.spec.datasource.name = "missing";

    const result = validateResource(dashboard);
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.errors[0]).toEqual(
        expect.objectContaining({
          code: "DATASOURCE_NOT_FOUND",
          path: "/spec/queries/recent-requests/spec/datasource/name",
        }),
      );
    }
  });
});

describe("QueryResult validation", () => {
  it("accepts the normalized result example", async () => {
    const value: unknown = JSON.parse(await fixture("results/average-model-latency.json"));
    const result = validateQueryResult(value);

    expect(result.valid).toBe(true);
    if (result.valid) expect(result.value.frames[0]?.length).toBe(2);
  });

  it("rejects fields whose value count differs from frame length", () => {
    const result = validateQueryResult({
      frames: [
        {
          length: 2,
          fields: [{ name: "value", type: "number", values: [1] }],
        },
      ],
    });

    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.errors).toEqual([
        expect.objectContaining({
          code: "FRAME_LENGTH_MISMATCH",
          path: "/frames/0/fields/0/values",
        }),
      ]);
    }
  });
});

describe("TransformationPipeline validation", () => {
  it("accepts the portable transformation example", async () => {
    const pipeline = parseTransformationPipeline(
      await fixture("transformations/cost-analysis.yaml"),
    );

    expect(pipeline.spec.transformations.map(({ kind }) => kind)).toEqual([
      "FilterRows",
      "CalculateField",
      "Sort",
      "Limit",
    ]);
  });

  it("rejects semantically invalid transformations", () => {
    const result = validateResource({
      apiVersion: OPENPLAIT_API_VERSION,
      kind: "TransformationPipeline",
      metadata: { name: "invalid-transformations" },
      spec: {
        transformations: [
          {
            kind: "JoinFrames",
            spec: { left: "requests", right: "requests", on: ["service"] },
          },
        ],
      },
    });

    expect(result.valid).toBe(false);
    if (!result.valid) expect(result.errors[0]?.code).toBe("TRANSFORMATION_INVALID");
  });
});

describe("AlertRule validation", () => {
  it("accepts and round-trips the ClickHouse alert example", async () => {
    const alert = parseAlertRule(await fixture("alerts/high-ai-cost.yaml"));

    expect(alert.spec.condition).toEqual(
      expect.objectContaining({ field: "total_cost", threshold: 100 }),
    );
    expect(parseResource(serializeDocument(alert))).toEqual(alert);
  });

  it("rejects zero evaluation intervals and duplicate channels", () => {
    const result = validateResource({
      apiVersion: OPENPLAIT_API_VERSION,
      kind: "AlertRule",
      metadata: { name: "invalid-alert" },
      spec: {
        query: {
          kind: "Query",
          spec: {
            mode: "semantic",
            datasource: { kind: "ClickHouseDatasource", name: "primary" },
            input: { signal: "traces", entity: "otel.spans" },
            select: [{ aggregate: { function: "count" }, as: "requests" }],
          },
        },
        condition: { field: "requests", operator: "greaterThan", threshold: 10 },
        evaluation: { every: "0s" },
        notifications: [{ channelRef: "ops" }, { channelRef: "ops" }],
      },
    });

    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.errors.map(({ code }) => code)).toEqual(["ALERT_INVALID", "ALERT_INVALID"]);
    }
  });
});
