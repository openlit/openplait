---
name: integrate-openplait
description: >-
  Install and wire OpenPlait into an application: npm packages, server-side
  DatasourceRegistry, OpenPlaitRuntime, portable SemanticQuery execution, and
  secret-safe config. Use when adding OpenPlait to a codebase, adopting
  @openplait/runtime, or connecting ClickHouse, Tempo, Loki, Prometheus, or
  Jaeger behind a portable query layer.
---

# Integrate OpenPlait

OpenPlait is a datasource-independent query and dataframe layer. The host app
owns credentials, authz, and UI. Adapters live on the **server** only.

## When to use related skills

| Goal | Skill |
| --- | --- |
| Custom backend adapter | `create-openplait-adapter` |
| ClickHouse / OTel datasets | `openplait-clickhouse` |
| Grafana Tempo / TraceQL | `openplait-tempo` |
| Grafana Loki / LogQL | `openplait-loki` |
| Prometheus / Mimir / PromQL | `openplait-prometheus` |
| Jaeger Query HTTP | `openplait-jaeger` |

## Steps

1. **Install** core packages plus the adapter(s) you need (published npm, or
   develop from `typescript/` in this repo):

```bash
npm install @openplait/core @openplait/adapter-sdk @openplait/runtime
# plus one or more:
# @openplait/adapter-clickhouse
# @openplait/adapter-tempo
# @openplait/adapter-loki
# @openplait/adapter-prometheus
# @openplait/adapter-jaeger
```

From this monorepo:

```bash
cd typescript && npm install && npm run build
```

2. **Register datasources on the server** with `DatasourceRegistry` + adapter
   instances. Never put passwords/tokens in query JSON, dashboards, or browser
   bundles.

3. **Create `OpenPlaitRuntime`** from the registry (timeouts, cancel, cache
   hooks as needed).

4. **Author portable `SemanticQuery`** resources (`apiVersion` from
   `@openplait/core`, `kind: "Query"`, `datasource: { kind, name }`).

5. **Execute** via `runtime.execute(query, context)` (or multi-query APIs) and
   consume normalized frames — do not leak backend-native payloads to clients
   unless intentionally exposing an opt-in native mode.

6. **Validate**: config validation, capability checks before unsupported ops,
   bounded time ranges / limits, abort signals, redacted errors.

## Hard rules

- Credentials stay in the app's connection vault / env — not in OpenPlait IR.
- Prefer semantic queries; gate native TraceQL/LogQL/PromQL/SQL behind allowlists.
- One named datasource per logical backend; route by `datasource.name` + `kind`.
- Keep OpenPlait application-neutral (no OpenLIT-only assumptions in shared packages).

## Python

A parallel Python package lives under `python/` (`pip install openplait` when
published). Prefer TypeScript `@openplait/*` from `typescript/` for production
adapters today; use `openplait.core` / `openplait.runtime` for IR parity and
registry wiring. See `python/README.md` and `docs/content/guides/python.mdx`.

## Docs

- Getting started: `docs/content/getting-started.mdx`
- TypeScript workspace: `docs/content/guides/typescript.mdx`
- Architecture: `docs/content/concepts/architecture.mdx`
- Multiple datasources: `docs/content/guides/multiple-datasources.mdx`
- Agent skills index: `docs/content/guides/agent-skills.mdx`
- Publishing (npm `ts-*` / PyPI `py-*`): `PUBLISHING.md`
