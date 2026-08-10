import { OPENPLAIT_API_VERSION, type NativeQuery } from "@openplait/core";
import { describe, expect, it } from "vitest";

import { TempoAdapter } from "../../src/index.js";

const tempoUrl = process.env.OPENPLAIT_TEMPO_INTEGRATION_URL;
const live = describe.runIf(Boolean(tempoUrl));

live("Tempo 2.8 pinned integration", () => {
  const config = {
    url: tempoUrl as string,
    allowNativeQueries: true,
    requestTimeoutMs: 10_000,
    queryTimeoutMs: 30_000,
    maxTimeRangeMs: 7 * 24 * 60 * 60 * 1_000,
  };

  it("inspects the real server and executes the minimal compatible search", async () => {
    const adapter = new TempoAdapter(config);
    const capabilities = await adapter.inspectServer({ timeoutMs: 10_000 });
    expect(capabilities.version).toMatch(/^v?2\.8\./);
    expect(capabilities.features.mostRecent).toBe(true);

    const end = new Date();
    const start = new Date(end.getTime() - 5 * 60 * 1_000);
    const query: NativeQuery = {
      apiVersion: OPENPLAIT_API_VERSION,
      kind: "Query",
      metadata: { name: "tempo-live-smoke" },
      spec: {
        mode: "native",
        datasource: { kind: "TempoDatasource", name: "tempo-live" },
        native: { language: "traceql", statement: "{ }" },
        extensions: {
          "io.openplait.tempo": {
            timeRange: { from: start.toISOString(), to: end.toISOString() },
            limit: 1,
            spansPerSpanSet: 1,
          },
        },
      },
    };
    const result = await adapter.execute(query, {
      audit: { requestId: "tempo-live-search" },
    });
    expect(result.metadata?.datasource).toBe("tempo");
    expect(result.frames[0]?.length).toBeGreaterThanOrEqual(0);
  });
});
