import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import { parseAlertRule } from "@openplait/core";
import { ClickHouseAdapter } from "@openplait/adapter-clickhouse";
import { describe, expect, it, vi } from "vitest";

import { AlertEvaluator, DatasourceRegistry, OpenPlaitRuntime } from "../src/index.js";

const examples = fileURLToPath(new URL("../../../../examples/", import.meta.url));

describe("ClickHouse alert evaluation", () => {
  it("executes an AlertRule through the ClickHouse adapter and enters firing", async () => {
    const queryCall = vi.fn().mockResolvedValue({
      query_id: "high-ai-cost-evaluation",
      response_headers: {},
      json: vi.fn().mockResolvedValue({
        data: [{ total_cost: 125.5 }],
        meta: [{ name: "total_cost", type: "Float64" }],
        rows: 1,
        statistics: { rows_read: 500 },
      }),
    });
    const config = { url: "http://localhost:8123" };
    const adapter = new ClickHouseAdapter(config, {
      client: { query: queryCall, close: vi.fn() } as never,
    });
    const runtime = new OpenPlaitRuntime(new DatasourceRegistry().register({
      name: "primary",
      kind: "ClickHouseDatasource",
      config,
      adapter,
    }));
    const evaluator = new AlertEvaluator(runtime);
    const alert = parseAlertRule(await readFile(`${examples}alerts/high-ai-cost.yaml`, "utf8"));
    alert.spec.evaluation.for = "0s";

    const evaluation = await evaluator.evaluate(alert, {
      audit: { requestId: "high-cost-1" },
      now: new Date("2026-08-06T12:00:00.000Z"),
    });

    expect(evaluation).toEqual(expect.objectContaining({
      state: "firing",
      value: 125.5,
      conditionMet: true,
    }));
    expect(queryCall).toHaveBeenCalledWith(expect.objectContaining({
      query: expect.stringContaining("sum(toFloat64OrZero(SpanAttributes['gen_ai.usage.cost']))"),
      query_params: {
        op_0: "2026-08-06T11:00:00.000Z",
        op_1: "2026-08-06T12:00:00.000Z",
      },
    }));
    expect(evaluation.notifications[0]).toEqual(
      expect.objectContaining({ event: "firing", channelRef: "default-operations" }),
    );
  });
});
