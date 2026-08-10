---
name: openplait-tempo
description: >-
  Wire @openplait/adapter-tempo for Grafana Tempo TraceQL search, OTLP span
  details, and tag discovery. Use when adding Tempo to OpenPlait, enabling
  native TraceQL, or configuring multitenancy and attribute mappings.
---

# OpenPlait Tempo Adapter

## Install

```bash
npm install @openplait/core @openplait/adapter-sdk @openplait/runtime \
  @openplait/adapter-tempo
```

## Register

```ts
import { TempoAdapter } from "@openplait/adapter-tempo";
import { DatasourceRegistry, OpenPlaitRuntime } from "@openplait/runtime";

const config = {
  url: process.env.TEMPO_URL!,
  httpHeaders: {
    // e.g. Authorization, X-Scope-OrgID — from vault, not query IR
  },
  allowNativeQueries: true,
  maxResultRows: 200,
  maxTimeRangeMs: 31 * 24 * 60 * 60 * 1000,
};

const registry = new DatasourceRegistry().register({
  name: "tempo",
  kind: "TempoDatasource",
  scope: "workspace",
  config,
  adapter: new TempoAdapter(config),
});

export const runtime = new OpenPlaitRuntime(registry);
```

## Notes

- Prefer bounded semantic TraceQL; treat native TraceQL as opt-in.
- Pass a guarded `fetch` from the host for SSRF controls when embedding in a product.
- Normalize to OpenPlait frames; do not ship raw Tempo JSON to browsers by default.

## Docs

- `docs/content/adapters/tempo.mdx`
- Skill: `integrate-openplait`
