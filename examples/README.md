# Examples

- [`queries/average-model-latency.yaml`](./queries/average-model-latency.yaml):
  portable semantic query with filters, grouping, aggregation, and ordering.
- [`queries/expensive-traces-native.yaml`](./queries/expensive-traces-native.yaml):
  ClickHouse-native escape hatch using bound parameters.
- [`queries/recent-tempo-errors.yaml`](./queries/recent-tempo-errors.yaml):
  portable bounded trace search compiled to TraceQL by the Tempo adapter.
- [`results/average-model-latency.json`](./results/average-model-latency.json):
  normalized dataframe output independent of the source response format.
- [`clickhouse/adapter-config.json`](./clickhouse/adapter-config.json): safe
  server-side defaults for the ClickHouse adapter, without credentials.
- [`clickhouse/average-model-latency.sql`](./clickhouse/average-model-latency.sql):
  representative compiled SQL with values kept in the adjacent bound-parameter
  document.
- [`tempo/adapter-config.json`](./tempo/adapter-config.json): safe server-side
  limits and a configurable canonical attribute mapping for Tempo.
- [`dashboards/clickhouse-observability.yaml`](./dashboards/clickhouse-observability.yaml):
  an application-neutral OpenPlait dashboard composing two named ClickHouse
  datasources with a query-driven variable, grid layout, and time series, stat,
  and table panels.
- [`perses/clickhouse-observability.yaml`](./perses/clickhouse-observability.yaml): a supported
  Perses dashboard fixture using native ClickHouse query plugins.
- [`transformations/cost-analysis.yaml`](./transformations/cost-analysis.yaml):
  a portable transformation pipeline with placement preferences, row filtering,
  a calculated field, sorting, and limiting.
- [`alerts/high-ai-cost.yaml`](./alerts/high-ai-cost.yaml): a portable
  ClickHouse-backed alert with a hold duration, lifecycle policies, labels,
  annotations, and provider-neutral notification references.

These files are loaded by conformance tests so they cannot drift from the
published schemas and compatibility contracts.
