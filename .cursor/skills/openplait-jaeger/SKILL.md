---
name: openplait-jaeger
description: >-
  Wire @openplait/adapter-jaeger for Jaeger Query HTTP service-scoped trace
  search and span events from Jaeger logs. Use when adding Jaeger to OpenPlait
  or diagnosing Jaeger search/list/operations integration.
---

# OpenPlait Jaeger Adapter

## Install

```bash
npm install @openplait/core @openplait/adapter-sdk @openplait/runtime \
  @openplait/adapter-jaeger
```

## Register

```ts
import { JaegerAdapter } from "@openplait/adapter-jaeger";
import { DatasourceRegistry, OpenPlaitRuntime } from "@openplait/runtime";

const config = {
  url: process.env.JAEGER_QUERY_URL!,
  httpHeaders: {},
  maxResultRows: 200,
  maxTimeRangeMs: 7 * 24 * 60 * 60 * 1000,
};

const registry = new DatasourceRegistry().register({
  name: "jaeger",
  kind: "JaegerDatasource",
  scope: "workspace",
  config,
  adapter: new JaegerAdapter(config),
});

export const runtime = new OpenPlaitRuntime(registry);
```

## Notes

- Jaeger search is **service-scoped**; use `/api/services` and operations APIs for discovery.
- Prefer **trace-budgeted** list/search patterns over filling a span budget from one fat trace.
- Span events map from Jaeger logs; normalize to OpenPlait frames.
- Host apps should use guarded fetch (SSRF), vault secrets, and health checks (GET/POST as product requires).

## Docs

- `docs/content/adapters/jaeger.mdx`
- Skill: `integrate-openplait`
