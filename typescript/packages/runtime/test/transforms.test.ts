import type { QueryResult, Transformation } from "@openplait/core";
import { describe, expect, it } from "vitest";

import { executeTransformations } from "../src/index.js";

function result(): QueryResult {
  return {
    frames: [{
      name: "metrics",
      length: 3,
      fields: [
        { name: "service", type: "string", values: ["search", "checkout", "search"] },
        { name: "requests", type: "number", values: [2, 4, 6] },
        { name: "latency", type: "duration", unit: "ms", values: [1000, null, 3000] },
        { name: "attributes", type: "json", values: [{ region: "us" }, { region: "eu" }, "{\"region\":\"us\"}"] },
        { name: "series", type: "number", values: [1, 2, 3], labels: { environment: "prod" } },
      ],
    }],
  };
}

describe("frame transformations", () => {
  it("filters, calculates, sorts, limits, selects, and renames fields", () => {
    const transformations: Transformation[] = [
      { kind: "FilterRows", spec: { condition: { field: "requests", operator: "greaterThan", value: "${minimum}" } } },
      { kind: "CalculateField", spec: { as: "double", expression: { multiply: [{ field: "requests" }, { value: 2 }] } } },
      { kind: "Sort", spec: { by: { field: "double", direction: "desc" } } },
      { kind: "Limit", spec: { count: 1 } },
      { kind: "SelectFields", spec: { fields: ["service", "double"] } },
      { kind: "RenameFields", spec: { mappings: { double: "score" } } },
    ];

    const transformed = executeTransformations(result(), transformations, { minimum: 3 });
    expect(transformed.frames[0]).toEqual({
      name: "metrics",
      length: 1,
      fields: [
        { name: "service", type: "string", values: ["search"] },
        { name: "score", type: "number", values: [12] },
      ],
    });
  });

  it("groups, reduces, fills values, converts units, and calculates windows", () => {
    const transformed = executeTransformations(result(), [
      { kind: "FillMissing", spec: { fields: ["latency"], strategy: "zero" } },
      { kind: "ConvertUnit", spec: { field: "latency", to: "s" } },
      { kind: "WindowCalculation", spec: { field: "requests", as: "running", function: "runningSum" } },
      {
        kind: "GroupAndReduce",
        spec: {
          by: ["service"],
          reductions: [
            { field: "requests", function: "sum", as: "requests" },
            { field: "latency", function: "avg", as: "average_latency" },
          ],
        },
      },
    ]);

    expect(transformed.frames[0]?.fields).toEqual([
      { name: "service", type: "string", values: ["search", "checkout"] },
      { name: "requests", type: "number", values: [8, 4] },
      { name: "average_latency", type: "number", values: [2, 0], unit: "s" },
    ]);
  });

  it("extracts JSON properties and materializes labels", () => {
    const transformed = executeTransformations(result(), [
      { kind: "ExtractJsonProperty", spec: { field: "attributes", path: "region", as: "region", type: "string" } },
      { kind: "LabelsToFields", spec: { fields: ["series"], prefix: "label." } },
    ]);

    expect(transformed.frames[0]?.fields).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: "region", values: ["us", "eu", "us"] }),
        expect.objectContaining({ name: "label.environment", values: ["prod", "prod", "prod"] }),
      ]),
    );
  });

  it("pivots, unpivots, merges, and joins frames", () => {
    const source: QueryResult = {
      frames: [
        {
          name: "long",
          length: 4,
          fields: [
            { name: "service", type: "string", values: ["a", "a", "b", "b"] },
            { name: "metric", type: "string", values: ["cost", "count", "cost", "count"] },
            { name: "value", type: "number", values: [10, 2, 12, 4] },
          ],
        },
        {
          name: "owners",
          length: 2,
          fields: [
            { name: "service", type: "string", values: ["a", "b"] },
            { name: "owner", type: "string", values: ["team-a", "team-b"] },
          ],
        },
      ],
    };
    const transformed = executeTransformations(source, [
      { kind: "JoinFrames", spec: { left: "long", right: "owners", on: ["service"], as: "wide" } },
      { kind: "Pivot", spec: { index: ["service", "owner"], column: "metric", value: "value" } },
      { kind: "Unpivot", spec: { fields: ["cost", "count"], keep: ["service", "owner"], namesTo: "metric", valuesTo: "value" } },
      { kind: "MergeFrames", spec: { frames: ["wide"], as: "merged" } },
    ]);

    expect(transformed.frames).toEqual([
      expect.objectContaining({
        name: "merged",
        length: 4,
        fields: expect.arrayContaining([
          expect.objectContaining({ name: "metric", values: ["cost", "count", "cost", "count"] }),
          expect.objectContaining({ name: "owner", values: ["team-a", "team-a", "team-b", "team-b"] }),
        ]),
      }),
    ]);
  });
});
