---
name: openplait-clickhouse
description: >-
  Wire @openplait/adapter-clickhouse for OTel traces, logs, metrics, aggregates,
  discovery, and native SQL. Use when integrating ClickHouse with OpenPlait,
  configuring dataset mappings, or mirroring OpenLIT Database Config behavior.
---

# OpenPlait ClickHouse Adapter

## Install

```bash
npm install @openplait/core @openplait/adapter-sdk @openplait/runtime \
  @openplait/adapter-clickhouse
```

## Register

```ts
import { ClickHouseAdapter } from "@openplait/adapter-clickhouse";
import { DatasourceRegistry, OpenPlaitRuntime } from "@openplait/runtime";

const config = {
  url: process.env.CLICKHOUSE_URL!,
  username: process.env.CLICKHOUSE_USER,
  password: process.env.CLICKHOUSE_PASSWORD,
  database: "observability",
};

const registry = new DatasourceRegistry().register({
  name: "primary",
  kind: "ClickHouseDatasource",
  scope: "workspace",
  config,
  adapter: new ClickHouseAdapter(config),
});

export const runtime = new OpenPlaitRuntime(registry, {
  defaultTimeoutMs: 30_000,
});
```

## Notes

- Use semantic queries against OTel entities; gate native SQL with allowlists.
- Dataset mappings are configurable; OpenLIT ships a consumer preset — do not
  hard-code OpenLIT table names into generic apps unless intended.
- Keep credentials server-side only.

## Docs

- `docs/content/adapters/clickhouse.mdx`
- `docs/content/getting-started.mdx`
- Skill: `integrate-openplait`
