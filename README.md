<div align="center">
  <img src="./brand/openplait-wordmark.svg" alt="OpenPlait" width="320" />
  <p><strong>Datasource-independent query &amp; dataframe layer</strong></p>

**[Docs](./docs) · [Getting started](./docs/content/getting-started.mdx) · [Publishing](./PUBLISHING.md) · [Contributing](./CONTRIBUTING.md) · [Brand](./docs/content/brand.mdx)**

[![License](https://img.shields.io/github/license/openlit/openplait?label=License&logo=github&color=d97706&logoColor=white)](./LICENSE)
[![npm scope](https://img.shields.io/badge/npm-%40openplait-cb3837?logo=npm)](https://www.npmjs.com/org/openplait)
[![Python](https://img.shields.io/badge/python-3.9%2B-blue?logo=python&logoColor=white)](./python)
[![GitHub](https://img.shields.io/badge/GitHub-openplait-181717?logo=github)](https://github.com/openlit/openplait)
</div>

OpenPlait is a standalone, **application-neutral** interoperability layer for
analytics and observability. It defines one portable query IR, normalized
dataframes, transformations, dashboards, and alerts — without replacing PromQL,
TraceQL, LogQL, SQL, or other native languages.

Host applications own credentials, authorization, and UI. Adapters compile and
execute bounded requests, then return OpenPlait frames any product can consume.

```bash
git clone git@github.com:openlit/openplait.git
cd openplait
```

| | |
| --- | --- |
| **SSH** | `git@github.com:openlit/openplait.git` |
| **HTTPS** | `https://github.com/openlit/openplait.git` |
| **API** | `openplait.io/v1alpha1` |
| **npm** | `@openplait/*` · `0.1.0-alpha.0` |
| **PyPI** | `openplait` · `0.1.0a0` |

---

## Repository layout

| Path | Role |
| --- | --- |
| [`typescript/`](./typescript) | npm workspaces — `@openplait/*` reference implementation |
| [`python/`](./python) | Poetry package — `openplait` on PyPI (alpha) |
| [`docs/`](./docs) | Documentation site |
| [`brand/`](./brand) | Logo mark, wordmark, and concept art |
| [`examples/`](./examples) | Portable query / dashboard examples |
| [`specifications/`](./specifications) | Spec notes + schema pointers |

| Language | Status | Install |
| --- | --- | --- |
| **TypeScript / Node** | Implemented (`@openplait/*`) | `npm install @openplait/core @openplait/runtime …` |
| **Python** | Adapters for all five connectors (`openplait`) | `pip install openplait` *(alpha)* |

---

## Why OpenPlait

- **One query model** across ClickHouse, Tempo, Loki, Prometheus/Mimir, Jaeger, and custom backends
- **Honest capabilities** — unsupported joins/ops fail explicitly before execution
- **Secret-safe** — connection config stays server-side; query resources only carry datasource refs
- **Normalized frames** — host UIs, alerts, and dashboards share one result shape
- **Agent-ready** — Cursor [Agent Skills](./.cursor/skills) help wire OpenPlait into any codebase

---

## TypeScript packages

Workspace root: [`typescript/`](./typescript). See [`typescript/README.md`](./typescript/README.md).

| Package | Role |
| --- | --- |
| [`@openplait/core`](./typescript/packages/core) | Query IR, schemas, validation, serialization |
| [`@openplait/adapter-sdk`](./typescript/packages/adapter-sdk) | `DatasourceAdapter` contract and HTTP helpers |
| [`@openplait/adapter-clickhouse`](./typescript/packages/adapter-clickhouse) | ClickHouse / OTel datasets |
| [`@openplait/adapter-tempo`](./typescript/packages/adapter-tempo) | Grafana Tempo / TraceQL |
| [`@openplait/adapter-loki`](./typescript/packages/adapter-loki) | Grafana Loki / LogQL |
| [`@openplait/adapter-prometheus`](./typescript/packages/adapter-prometheus) | Prometheus / Mimir / PromQL |
| [`@openplait/adapter-jaeger`](./typescript/packages/adapter-jaeger) | Jaeger Query HTTP API |
| [`@openplait/runtime`](./typescript/packages/runtime) | Registry, planning, multi-query, alert intents |
| [`@openplait/perses`](./typescript/packages/perses) | Perses import/export bindings |

### Quick start

```bash
cd typescript
npm install
npm run check
```

```bash
npm install @openplait/core @openplait/adapter-sdk \
  @openplait/runtime @openplait/adapter-clickhouse
```

```ts
import { ClickHouseAdapter } from "@openplait/adapter-clickhouse";
import { DatasourceRegistry, OpenPlaitRuntime } from "@openplait/runtime";
import { OPENPLAIT_API_VERSION, type SemanticQuery } from "@openplait/core";

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

const runtime = new OpenPlaitRuntime(registry, { defaultTimeoutMs: 30_000 });
```

Guides: [TypeScript](./docs/content/guides/typescript.mdx) · [Getting started](./docs/content/getting-started.mdx).

---

## Python

Package root: [`python/`](./python). See [`python/README.md`](./python/README.md)
and the [Python guide](./docs/content/guides/python.mdx).

```bash
cd python
poetry install
poetry run pytest
```

---

## Agent skills

Cursor skills under [`.cursor/skills/`](./.cursor/skills):

| Skill | Use when |
| --- | --- |
| `integrate-openplait` | Install + registry + runtime + queries |
| `create-openplait-adapter` | Custom `DatasourceAdapter` |
| `openplait-clickhouse` / `tempo` / `loki` / `prometheus` / `jaeger` | Wire a shipped adapter |

---

## Development

```sh
# TypeScript
cd typescript && npm install && npm run check && npm run build

# Python
cd python && poetry install && poetry run pytest

# Docs site (from repo root)
npm run docs:dev
```

See [`CONTRIBUTING.md`](./CONTRIBUTING.md) and [`plan.md`](./plan.md).

---

## Release workflow

Tag-driven publishes for npm and PyPI:

| Ecosystem | Sources | Tag | Workflow |
| --- | --- | --- | --- |
| **npm** `@openplait/*` | [`typescript/`](./typescript) | `ts-*.*.*` | [npm-release.yml](./.github/workflows/npm-release.yml) |
| **PyPI** `openplait` | [`python/`](./python) | `py-*.*.*` | [pypi-release.yml](./.github/workflows/pypi-release.yml) |

Details: [`PUBLISHING.md`](./PUBLISHING.md).

```sh
# npm alpha
cd typescript
VERSION=$(node -p "require('./packages/core/package.json').version")
git tag "ts-${VERSION}" && git push origin "ts-${VERSION}"

# PyPI alpha
cd python
VERSION=$(poetry version -s)
git tag "py-${VERSION}" && git push origin "py-${VERSION}"
```

---

## Brand

| Asset | Path |
| --- | --- |
| Wordmark | [`brand/openplait-wordmark.svg`](./brand/openplait-wordmark.svg) |
| Mark | [`brand/openplait-mark.svg`](./brand/openplait-mark.svg) |
| Concept | [`brand/openplait-logo-concept.png`](./brand/openplait-logo-concept.png) |

Usage guidance: [Brand docs](./docs/content/brand.mdx).

## Project status

OpenPlait is **pre-release**. The `v1alpha1` API may evolve. See
[`GOVERNANCE.md`](./GOVERNANCE.md) and [`SECURITY.md`](./SECURITY.md).

## License

[Apache-2.0](./LICENSE)
