# OpenPlait (Python)

Python port of [OpenPlait](https://github.com/openlit/openplait) — a
datasource-independent query and dataframe layer for analytics and
observability applications.

Status: **1.0.0**. Ships `core`, `adapter_sdk`, `runtime`, and adapters for
**ClickHouse, Tempo, Loki, Prometheus, and Jaeger** (native execute first;
TypeScript remains the semantic-compile reference).

## Install

```bash
pip install openplait
# or from this repo:
poetry install
```

Requires **Python 3.9+**.

## Quick start

```python
from openplait.adapters import LokiAdapter, LokiConfig
from openplait.runtime import DatasourceRegistry, OpenPlaitRuntime
from openplait.runtime.registry import RuntimeDatasourceRegistration

config = LokiConfig(url="http://localhost:3100")
registry = DatasourceRegistry().register(
    RuntimeDatasourceRegistration(
        name="logs",
        kind="LokiDatasource",
        adapter=LokiAdapter(config),
        config=config,
    )
)
runtime = OpenPlaitRuntime(registry)
```

## Layout

| Module | Role |
| --- | --- |
| `openplait.core` | `openplait.io/v1alpha1` models, parse/validate |
| `openplait.adapter_sdk` | Adapter protocol, errors, HTTP helpers |
| `openplait.runtime` | Datasource registry + runtime orchestration |
| `openplait.adapters.clickhouse` | Native SQL via ClickHouse HTTP |
| `openplait.adapters.tempo` | Native TraceQL search |
| `openplait.adapters.loki` | Native LogQL `query_range` |
| `openplait.adapters.prometheus` | Native PromQL `query_range` |
| `openplait.adapters.jaeger` | Semantic Jaeger Query HTTP search |

## Release

Push a `py-*.*.*` tag that matches `[tool.poetry].version` to publish.
See [`../PUBLISHING.md`](../PUBLISHING.md).

## License

Apache-2.0
