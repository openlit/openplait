# `@openplait/adapter-clickhouse`

The first OpenPlait datasource adapter. It compiles portable semantic queries
to parameterized ClickHouse SQL and normalizes ClickHouse responses into
`@openplait/core` dataframes.

The default mappings cover the standard OpenTelemetry ClickHouse tables:

| Logical dataset | Physical table |
| --- | --- |
| `otel.spans` | `otel_traces` |
| `otel.logs` | `otel_logs` |
| `otel.metrics.gauge` | `otel_metrics_gauge` |
| `otel.metrics.sum` | `otel_metrics_sum` |
| `otel.metrics.histogram` | `otel_metrics_histogram` |

Application-specific mappings are supplied through `config.datasets`. The
package exports `OPENLIT_CLICKHOUSE_DATASETS` as an optional preset for OpenLIT;
it is not part of the adapter's defaults.

## Usage

```ts
import {
  ClickHouseAdapter,
} from "@openplait/adapter-clickhouse";

const adapter = new ClickHouseAdapter({
  url: "https://clickhouse.example.com:8443",
  username: process.env.CLICKHOUSE_USER,
  password: process.env.CLICKHOUSE_PASSWORD,
  database: "observability",
  httpHeaders: { "X-ClickHouse-Quota": "openlit" },
  maxResultRows: 10_000,
  maxRowsToRead: 10_000_000,
  maxTimeRangeMs: 31 * 24 * 60 * 60 * 1_000,
  queryTimeoutMs: 30_000,
});

const compiled = await adapter.compile(query, {
  variables: {
    __from: "2026-08-05T00:00:00.000Z",
    __to: "2026-08-05T01:00:00.000Z",
  },
});

const result = await adapter.execute(compiled, {
  audit: { requestId: "dashboard-request-123", actorId: "user-42" },
});

await adapter.close();
```

OpenLIT can opt into its additional logical datasets without changing the
generic adapter contract:

```ts
import {
  ClickHouseAdapter,
  OPENLIT_CLICKHOUSE_DATASETS,
} from "@openplait/adapter-clickhouse";

const adapter = new ClickHouseAdapter({
  url: clickhouseUrl,
  datasets: [...OPENLIT_CLICKHOUSE_DATASETS],
});
```

Do not put credentials in dashboard resources. Resolve them on the server and
construct each named adapter instance behind the consuming application's
server-side datasource registry.

## Safety defaults

- Canonical fields resolve only through the selected dataset's allowlist.
- Tables are selected only through registered logical datasets.
- Values use ClickHouse query parameters and are never interpolated into SQL.
- A time range is required by default and capped at 31 days.
- Results, rows read, and execution time are capped at both SQL and server
  setting boundaries.
- Queries execute with ClickHouse `readonly=1`.
- Tenant predicates are adapter-owned and cannot be removed by a query.
- Compiled queries must originate from the executing adapter instance.
- Execution requires a safe audit request ID.
- Native SQL is disabled unless `allowNativeQueries: true` is set by the server
  administrator. When enabled, it remains single-statement and read-only, and
  every declared parameter must be referenced through ClickHouse bindings.

Native mode intentionally bypasses semantic field and table allowlists. Treat
it as a privileged server-side feature, never as an end-user SQL console.

## Supported semantic operations

Select, recursive filters, aggregation, grouping, time buckets, ordering,
limits, percentiles, distinct count, rate, histogram, and arithmetic are
supported. Semantic joins are reported as unsupported because the current core
join expression cannot identify the left and right operands unambiguously.

`discoverSchema()` returns the canonical fields and types for all registered
datasets. `explain()` returns the generated SQL, bound parameters, output field
contract, and compilation steps without contacting ClickHouse.
