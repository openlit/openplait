"use client";

import { useState } from "react";
import { cn } from "@/lib/utils";

type Lang = "typescript" | "python";

const steps: Record<
  Lang,
  Array<{ label: string; code: string }>
> = {
  typescript: [
    {
      label: "Install",
      code: `npm install @openplait/core \\
  @openplait/adapter-sdk \\
  @openplait/runtime \\
  @openplait/adapter-clickhouse \\
  @openplait/adapter-jaeger`,
    },
    {
      label: "Register",
      code: `import { ClickHouseAdapter } from "@openplait/adapter-clickhouse";
import { JaegerAdapter } from "@openplait/adapter-jaeger";
import { DatasourceRegistry } from "@openplait/runtime";

const datasources = new DatasourceRegistry()
  .register({
    name: "primary",
    kind: "ClickHouseDatasource",
    scope: "workspace",
    config: { url: process.env.CLICKHOUSE_URL! },
    adapter: new ClickHouseAdapter({ url: process.env.CLICKHOUSE_URL! }),
  })
  .register({
    name: "jaeger",
    kind: "JaegerDatasource",
    scope: "workspace",
    config: { url: "http://localhost:16686" },
    adapter: new JaegerAdapter({ url: "http://localhost:16686" }),
  });`,
    },
    {
      label: "Query",
      code: `const response = await runtime.execute({
  queries: [query],
  variables: {
    __from: "2026-08-05T00:00:00Z",
    __to: "2026-08-05T01:00:00Z",
  },
  audit: { requestId: "dashboard-123" },
});

console.log(response.result.frames);`,
    },
  ],
  python: [
    {
      label: "Install",
      code: `pip install openplait
# or from the repo:
# cd python && poetry install`,
    },
    {
      label: "Register",
      code: `from openplait.adapters import ClickHouseAdapter, ClickHouseConfig
from openplait.runtime import DatasourceRegistry, OpenPlaitRuntime
from openplait.runtime.registry import RuntimeDatasourceRegistration

config = ClickHouseConfig(url="http://localhost:8123", database="openlit")
registry = DatasourceRegistry().register(
    RuntimeDatasourceRegistration(
        name="primary",
        kind="ClickHouseDatasource",
        adapter=ClickHouseAdapter(config),
        config=config,
    )
)
runtime = OpenPlaitRuntime(registry)`,
    },
    {
      label: "Query",
      code: `from openplait import OPENPLAIT_API_VERSION
from openplait.core import parse_query, validate_query

query = parse_query({
    "apiVersion": OPENPLAIT_API_VERSION,
    "kind": "Query",
    "metadata": {"name": "spans-sample"},
    "spec": {
        "mode": "semantic",
        "datasource": {"kind": "ClickHouseDatasource", "name": "primary"},
        "input": {"signal": "traces", "entity": "otel.spans"},
        "select": [{"field": "service.name"}],
        "limit": 25,
    },
})
assert validate_query(query).valid`,
    },
  ],
};

export function QuickStart() {
  const [lang, setLang] = useState<Lang>("typescript");
  const [active, setActive] = useState(0);
  const tabs = steps[lang];
  const current = Math.min(active, tabs.length - 1);

  return (
    <section className="rounded-ui border border-brandPrimary/25 bg-brandPrimary/[0.04] p-5 md:p-6">
      <div className="mb-5 max-w-2xl">
        <h2 className="text-2xl font-bold tracking-tight text-stone-900 dark:text-white">
          From install to portable query
        </h2>
        <p className="mt-2 text-stone-600 dark:text-stone-400">
          Register server-side adapters, then execute the same resource through the runtime —
          TypeScript today, Python alpha alongside.
        </p>
      </div>

      <div
        className="mb-3 flex flex-wrap gap-2"
        role="tablist"
        aria-label="Language"
      >
        {(
          [
            ["typescript", "TypeScript"],
            ["python", "Python"],
          ] as const
        ).map(([id, label]) => (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={lang === id}
            onClick={() => {
              setLang(id);
              setActive(0);
            }}
            className={cn(
              "rounded-ui px-3 py-1.5 text-sm font-medium transition",
              lang === id
                ? "bg-brandPrimary text-white"
                : "border border-stone-200 bg-white text-stone-700 dark:border-stone-700 dark:bg-stone-950 dark:text-stone-300",
            )}
          >
            {label}
          </button>
        ))}
      </div>

      <div className="mb-3 flex flex-wrap gap-2" role="tablist" aria-label="Quick start">
        {tabs.map((tab, index) => (
          <button
            key={tab.label}
            type="button"
            role="tab"
            aria-selected={current === index}
            onClick={() => setActive(index)}
            className={cn(
              "rounded-ui px-3 py-1.5 text-sm font-medium transition",
              current === index
                ? "border border-brandPrimary/40 bg-white text-brandPrimary dark:bg-stone-950"
                : "border border-stone-200 bg-white/70 text-stone-700 dark:border-stone-700 dark:bg-stone-950 dark:text-stone-300",
            )}
          >
            {tab.label}
          </button>
        ))}
      </div>
      <pre className="overflow-x-auto rounded-ui border border-stone-800 bg-stone-950 p-4 text-sm text-stone-100">
        <code>{tabs[current].code}</code>
      </pre>
    </section>
  );
}
