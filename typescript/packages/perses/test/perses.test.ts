import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import { parseDashboard, parseDocument } from "@openplait/core";
import { describe, expect, it } from "vitest";

import {
  RendererBindingError,
  analyzePersesDashboard,
  createDashboardRenderModel,
  exportPersesDashboard,
  importPersesDashboard,
  parsePersesDashboard,
  serializePersesDashboard,
} from "../src/index.js";

const examples = fileURLToPath(new URL("../../../../examples/", import.meta.url));

async function fixture(path: string): Promise<string> {
  return readFile(`${examples}${path}`, "utf8");
}

describe("Perses compatibility", () => {
  it("reports malformed panel structure without throwing an implementation error", () => {
    const report = analyzePersesDashboard({
      kind: "Dashboard",
      metadata: { name: "invalid" },
      spec: { panels: { broken: null }, layouts: [], duration: "1h" },
    });

    expect(report.compatible).toBe(false);
    expect(report.diagnostics).toEqual([
      expect.objectContaining({
        code: "INVALID_PERSES_DASHBOARD",
        path: "/spec/panels/broken",
      }),
    ]);
  });

  it("imports and exactly re-exports the supported Perses fixture", async () => {
    const source = await fixture("perses/clickhouse-observability.yaml");
    const original = parseDocument(source);
    const dashboard = parsePersesDashboard(source);

    expect(dashboard.apiVersion).toBe("openplait.io/v1alpha1");
    expect(exportPersesDashboard(dashboard)).toEqual(original);
  });

  it("preserves unsupported visualization plugins while warning renderers", async () => {
    const value = parseDocument(await fixture("perses/clickhouse-observability.yaml"));
    if (typeof value !== "object" || value === null) throw new Error("Fixture is invalid.");
    const changed = structuredClone(value) as {
      spec: { panels: { "request-rate": { spec: { plugin: { kind: string; spec: object } } } } };
    };
    changed.spec.panels["request-rate"].spec.plugin = {
      kind: "GaugeChart",
      spec: { calculation: "last" },
    };

    const report = analyzePersesDashboard(changed);
    expect(report.compatible).toBe(true);
    expect(report.diagnostics).toEqual([
      expect.objectContaining({ code: "UNSUPPORTED_VISUALIZATION", severity: "warning" }),
    ]);

    const dashboard = importPersesDashboard(changed);
    expect(exportPersesDashboard(dashboard)).toEqual(changed);
    expect(() => createDashboardRenderModel(dashboard)).toThrow(RendererBindingError);
  });

  it("embeds and reconstructs OpenPlait query definitions", async () => {
    const original = parseDashboard(await fixture("dashboards/clickhouse-observability.yaml"));
    const exported = exportPersesDashboard(original);
    const requestQuery = exported.spec.panels["request-rate"]?.spec.queries?.[0];

    expect(requestQuery).toEqual(
      expect.objectContaining({
        kind: "TimeSeriesQuery",
        spec: expect.objectContaining({
          plugin: expect.objectContaining({ kind: "OpenPlaitQuery" }),
        }),
      }),
    );

    const restored = importPersesDashboard(exported);
    expect(restored.metadata).toEqual(original.metadata);
    expect(restored.spec.queries).toEqual(original.spec.queries);
    expect(restored.spec.panels).toEqual(original.spec.panels);
    expect(restored.spec.variables).toEqual(original.spec.variables);
    expect(restored.spec.panels["recent-requests"]?.spec.transformations).toEqual([
      { kind: "Limit", spec: { count: 50 }, execution: { preference: "runtime" } },
    ]);
  });

  it("serializes a self-contained Perses document", async () => {
    const dashboard = parseDashboard(await fixture("dashboards/clickhouse-observability.yaml"));
    const yaml = serializePersesDashboard(dashboard, "yaml", { project: "observability" });
    const parsed = parseDocument(yaml) as { metadata: { project?: string }; spec: object };

    expect(parsed.metadata.project).toBe("observability");
    expect(parsed.spec).not.toHaveProperty("queries");
  });
});

describe("Portable renderer bindings", () => {
  it("resolves the grid and supported visualization/query bindings", async () => {
    const dashboard = parseDashboard(await fixture("dashboards/clickhouse-observability.yaml"));
    const model = createDashboardRenderModel(dashboard);

    expect(model.sections).toHaveLength(1);
    expect(model.sections[0]?.items.map(({ panel }) => panel.kind)).toEqual([
      "timeSeries",
      "stat",
      "table",
    ]);
    expect(model.sections[0]?.items[0]?.panel.queries[0]).toEqual(
      expect.objectContaining({ source: "openplait", queryRef: "#/spec/queries/request-rate" }),
    );
    expect(Object.keys(model.datasources)).toEqual(["primary", "archive"]);
    expect(model.datasources.primary?.plugin.kind).toBe("ClickHouseDatasource");
    const recentQuery = model.sections[0]?.items[2]?.panel.queries[0];
    expect(recentQuery?.source === "openplait" && recentQuery.query.datasource.name).toBe("archive");
    expect(model.sections[0]?.items[2]?.panel.transformations).toEqual([
      { kind: "Limit", spec: { count: 50 }, execution: { preference: "runtime" } },
    ]);
  });

  it("retains native ClickHouse query plugins from Perses", async () => {
    const dashboard = parsePersesDashboard(await fixture("perses/clickhouse-observability.yaml"));
    const model = createDashboardRenderModel(dashboard);
    const query = model.sections[0]?.items[0]?.panel.queries[0];

    expect(query).toEqual(
      expect.objectContaining({
        source: "plugin",
        plugin: expect.objectContaining({ kind: "ClickHouseTimeSeriesQuery" }),
      }),
    );
  });
});
