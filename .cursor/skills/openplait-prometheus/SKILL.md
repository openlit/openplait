---
name: openplait-prometheus
description: >-
  Wire @openplait/adapter-prometheus for PromQL range queries, metric/label
  discovery, and Prometheus-compatible APIs including Mimir. Use when adding
  Prometheus or Mimir to OpenPlait.
---

# OpenPlait Prometheus Adapter

## Install

```bash
npm install @openplait/core @openplait/adapter-sdk @openplait/runtime \
  @openplait/adapter-prometheus
```

## Register

```ts
import { PrometheusAdapter } from "@openplait/adapter-prometheus";
import { DatasourceRegistry, OpenPlaitRuntime } from "@openplait/runtime";

const config = {
  url: process.env.PROMETHEUS_URL!,
  httpHeaders: {},
  allowNativeQueries: true,
  maxTimeRangeMs: 31 * 24 * 60 * 60 * 1000,
};

const registry = new DatasourceRegistry().register({
  name: "prometheus",
  kind: "PrometheusDatasource",
  scope: "workspace",
  config,
  adapter: new PrometheusAdapter(config),
});

export const runtime = new OpenPlaitRuntime(registry);
```

## Notes

- Works with Prometheus-compatible HTTP APIs (including Mimir).
- Prefer semantic metric queries; gate raw PromQL with `allowNativeQueries`.
- Normalize to time-series frames per `@openplait/core`.

## Docs

- `docs/content/adapters/prometheus.mdx`
- Skill: `integrate-openplait`
