# OpenPlait (Python)

Python port of [OpenPlait](https://github.com/openlit/openplait) — a
datasource-independent query and dataframe layer for analytics and
observability applications.

Status: **alpha**. The TypeScript `@openplait/*` packages under
[`../typescript`](../typescript) are the reference implementation. This package
mirrors `core`, `adapter_sdk`, and `runtime` first; backend adapters land
incrementally.

## Install

```bash
pip install openplait
# or from this repo:
poetry install
```

Requires **Python 3.9+**.

## Quick start

```python
from openplait import OPENPLAIT_API_VERSION
from openplait.core import parse_query, validate_query
from openplait.runtime import DatasourceRegistry, OpenPlaitRuntime

document = {
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
}

query = parse_query(document)
assert validate_query(query).valid

registry = DatasourceRegistry()
runtime = OpenPlaitRuntime(registry)
# Register adapters with secrets from your vault / env — never from the query IR.
```

## Layout

| Module | Role |
| --- | --- |
| `openplait.core` | `openplait.io/v1alpha1` models, parse/validate |
| `openplait.adapter_sdk` | Adapter protocols and errors |
| `openplait.runtime` | Datasource registry + runtime orchestration |
| `openplait.adapters` | Backend adapters (ClickHouse scaffold first) |

## Release

Push a `py-*.*.*` tag that matches `[tool.poetry].version` to publish.
See [`../PUBLISHING.md`](../PUBLISHING.md).

## License

Apache-2.0
