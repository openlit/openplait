import { describe, expect, it } from "vitest";

import { AdapterError, isAbortError, isCompiledQuery } from "../src/index.js";

describe("adapter SDK utilities", () => {
  it("identifies compiled query envelopes", () => {
    expect(
      isCompiledQuery({
        kind: "CompiledQuery",
        language: "sql",
        compiled: { statement: "SELECT 1" },
        parameters: {},
        fields: [],
        source: { resourceName: "one", dataset: "system.one" },
        warnings: [],
      }),
    ).toBe(true);
    expect(isCompiledQuery({ kind: "Query" })).toBe(false);
  });

  it("retains typed adapter error context", () => {
    const cause = new Error("socket closed");
    const error = new AdapterError("EXECUTION_FAILED", "Query failed.", {
      cause,
      path: "/spec/select/0",
      details: { queryId: "request-1" },
    });

    expect(error.code).toBe("EXECUTION_FAILED");
    expect(error.cause).toBe(cause);
    expect(error.path).toBe("/spec/select/0");
  });

  it("recognizes abort-shaped errors", () => {
    expect(isAbortError(new DOMException("Stopped", "AbortError"))).toBe(true);
    expect(isAbortError(new Error("request aborted"))).toBe(true);
    expect(isAbortError(new Error("connection refused"))).toBe(false);
  });
});
