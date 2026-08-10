import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import { parseAlertRule, type QueryResult } from "@openplait/core";
import { describe, expect, it, vi } from "vitest";

import {
  AlertEvaluator,
  InMemoryAlertStateStore,
  RuntimeError,
  nextAlertEvaluationAt,
  type RuntimeExecutionResponse,
} from "../src/index.js";
import type { OpenPlaitRuntime } from "../src/runtime.js";

const examples = fileURLToPath(new URL("../../../../examples/", import.meta.url));

async function rule() {
  return parseAlertRule(await readFile(`${examples}alerts/high-ai-cost.yaml`, "utf8"));
}

function response(result: QueryResult): RuntimeExecutionResponse {
  return {
    result,
    deferredTransformations: [],
    plan: { queries: [], sourceTransformations: [], runtimeTransformations: [], clientTransformations: [] },
    metadata: {
      executionTimeMs: 1,
      queryCount: 1,
      sourceTransformations: [],
      runtimeTransformations: [],
      clientTransformations: [],
      queries: [],
      warnings: [],
    },
  };
}

function valueResult(value?: number): QueryResult {
  return {
    frames: [{
      name: "cost",
      length: value === undefined ? 0 : 1,
      fields: [{ name: "total_cost", type: "number", values: value === undefined ? [] : [value] }],
    }],
  };
}

describe("alert evaluation", () => {
  it("moves pending to firing and emits firing/resolved notification intents", async () => {
    const execute = vi.fn()
      .mockResolvedValueOnce(response(valueResult(150)))
      .mockResolvedValueOnce(response(valueResult(150)))
      .mockResolvedValueOnce(response(valueResult(50)));
    const evaluator = new AlertEvaluator({ execute } as unknown as Pick<OpenPlaitRuntime, "execute">);
    const alert = await rule();

    const pending = await evaluator.evaluate(alert, {
      audit: { requestId: "alert-1" },
      now: new Date("2026-08-06T00:00:00.000Z"),
    });
    const firing = await evaluator.evaluate(alert, {
      audit: { requestId: "alert-2" },
      now: new Date("2026-08-06T00:10:00.000Z"),
    });
    const resolved = await evaluator.evaluate(alert, {
      audit: { requestId: "alert-3" },
      now: new Date("2026-08-06T00:11:00.000Z"),
    });

    expect(pending).toEqual(expect.objectContaining({ state: "pending", value: 150, notifications: [] }));
    expect(firing.notifications).toEqual([
      expect.objectContaining({ channelRef: "default-operations", event: "firing" }),
    ]);
    expect(resolved.notifications).toEqual([
      expect.objectContaining({ channelRef: "default-operations", event: "resolved" }),
    ]);
    expect(execute.mock.calls[0]?.[0].variables).toEqual(
      expect.objectContaining({
        __from: "2026-08-05T23:00:00.000Z",
        __to: "2026-08-06T00:00:00.000Z",
      }),
    );
  });

  it("applies no-data and error policies without owning delivery", async () => {
    const alert = await rule();
    alert.spec.notifications?.[0]?.notifyOn?.push("no_data");
    const noData = new AlertEvaluator({
      execute: vi.fn().mockResolvedValue(response(valueResult())),
    } as unknown as Pick<OpenPlaitRuntime, "execute">);
    const noDataResult = await noData.evaluate(alert, {
      audit: { requestId: "no-data" },
      now: new Date("2026-08-06T00:00:00.000Z"),
    });

    const failed = new AlertEvaluator({
      execute: vi.fn().mockRejectedValue(new Error("ClickHouse unavailable")),
    } as unknown as Pick<OpenPlaitRuntime, "execute">);
    const errorResult = await failed.evaluate(alert, {
      audit: { requestId: "error" },
      now: new Date("2026-08-06T00:00:00.000Z"),
    });

    expect(noDataResult.state).toBe("no_data");
    expect(noDataResult.notifications[0]?.event).toBe("no_data");
    expect(errorResult).toEqual(expect.objectContaining({ state: "error", reason: "ClickHouse unavailable" }));
    expect(errorResult.notifications[0]?.event).toBe("error");
  });

  it("preserves active timing through suppression", async () => {
    const alert = await rule();
    const store = new InMemoryAlertStateStore();
    const execute = vi.fn().mockResolvedValue(response(valueResult(150)));
    const evaluator = new AlertEvaluator(
      { execute } as unknown as Pick<OpenPlaitRuntime, "execute">,
      { stateStore: store },
    );

    await evaluator.evaluate(alert, {
      audit: { requestId: "pending" },
      now: new Date("2026-08-06T00:00:00.000Z"),
    });
    const suppressed = await evaluator.evaluate(alert, {
      audit: { requestId: "suppressed" },
      now: new Date("2026-08-06T00:11:00.000Z"),
      suppressed: true,
    });
    const resumed = await evaluator.evaluate(alert, {
      audit: { requestId: "resumed" },
      now: new Date("2026-08-06T00:12:00.000Z"),
    });

    expect(suppressed.state).toBe("suppressed");
    expect(resumed.state).toBe("firing");
    expect(execute).toHaveBeenCalledTimes(2);
  });

  it("propagates caller cancellation without changing alert state", async () => {
    const alert = await rule();
    const evaluator = new AlertEvaluator({
      execute: vi.fn().mockRejectedValue(new RuntimeError("CANCELLED", "Cancelled")),
    } as unknown as Pick<OpenPlaitRuntime, "execute">);

    await expect(evaluator.evaluate(alert, {
      audit: { requestId: "cancelled" },
      now: new Date("2026-08-06T00:00:00.000Z"),
    })).rejects.toMatchObject({ code: "CANCELLED" });
  });

  it("calculates the next host-scheduled evaluation time", async () => {
    expect(nextAlertEvaluationAt(
      await rule(),
      new Date("2026-08-06T00:00:00.000Z"),
    ).toISOString()).toBe("2026-08-06T00:05:00.000Z");
  });
});
