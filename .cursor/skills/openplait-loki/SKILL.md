---
name: openplait-loki
description: >-
  Wire @openplait/adapter-loki for Grafana Loki LogQL streams, semantic log
  filters, and label discovery. Use when adding Loki to OpenPlait or enabling
  native LogQL behind capability checks.
---

# OpenPlait Loki Adapter

## Install

```bash
npm install @openplait/core @openplait/adapter-sdk @openplait/runtime \
  @openplait/adapter-loki
```

## Register

```ts
import { LokiAdapter } from "@openplait/adapter-loki";
import { DatasourceRegistry, OpenPlaitRuntime } from "@openplait/runtime";

const config = {
  url: process.env.LOKI_URL!,
  httpHeaders: {},
  allowNativeQueries: true,
  maxResultRows: 1000,
  maxTimeRangeMs: 7 * 24 * 60 * 60 * 1000,
};

const registry = new DatasourceRegistry().register({
  name: "loki",
  kind: "LokiDatasource",
  scope: "workspace",
  config,
  adapter: new LokiAdapter(config),
});

export const runtime = new OpenPlaitRuntime(registry);
```

## Notes

- Bound time ranges and row limits; honor abort signals.
- Semantic filters compile to LogQL; native LogQL needs an explicit allowlist.
- Redact auth headers from errors and explain output.

## Docs

- `docs/content/adapters/loki.mdx`
- Skill: `integrate-openplait`
