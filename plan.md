# OpenPlait Package Plan

## 1. Purpose

**OpenPlait** should be a datasource-independent interoperability layer between applications such as OpenLIT and systems such as:

* ClickHouse
* Prometheus
* Loki
* Tempo
* MySQL and PostgreSQL
* Elasticsearch or OpenSearch
* Future analytics and observability backends

Its job is not to replace SQL, PromQL, LogQL, or TraceQL.

Its job is to provide a common representation that applications can use for:

1. Queries
2. Results
3. Transformations
4. Visualizations
5. Dashboards
6. Alerts
7. Datasource capabilities

The initial flow inside OpenLIT would be:

```text
OpenLIT dashboard builder
          │
          ▼
OpenPlait specifications
          │
          ├── Query IR
          ├── Transformation IR
          ├── Visualization spec
          └── Alert IR
          │
          ▼
Datasource adapter
          │
          ├── ClickHouse SQL
          ├── PromQL
          ├── LogQL
          ├── TraceQL
          └── MySQL SQL
          │
          ▼
Normalized OpenPlait result
          │
          ▼
OpenLIT renderer
```

## 2. Relationship with Perses

Perses already provides an open dashboard and datasource specification intended for interoperability across tools. It models dashboards using `datasources`, `variables`, `panels`, `layouts`, time duration, and refresh interval.

OpenPlait should therefore **adopt Perses-compatible visualization concepts**, rather than inventing another incompatible dashboard format.

The useful Perses conventions to retain are:

* Kubernetes-style resources with `kind`, `metadata`, and `spec`
* Panels stored independently from layouts
* Plugin objects represented as `kind` plus `spec`
* Queries represented as typed plugins
* JSON references connecting layout items to panels
* Scoped datasources
* Variables as first-class dashboard resources
* Declarative YAML or JSON
* Validation through schemas
* Versioned, migratable specifications

Perses deliberately separates panel definitions from panel placement, allowing a layout item to reference a panel through `$ref`.

OpenPlait should preserve this pattern.

However, OpenPlait should extend beyond Perses in four important areas:

| Area            | Perses role                                  | OpenPlait role                                             |
| --------------- | -------------------------------------------- | ---------------------------------------------------------- |
| Dashboard       | Primary open dashboard model                 | Perses-compatible or directly reusable                     |
| Visualization   | Plugin-based panels                          | Common visualization grammar                               |
| Query           | Datasource-specific query plugins            | Datasource-neutral Query IR plus native-query escape hatch |
| Transformations | Mostly renderer/tool-specific                | Portable Transformation IR                                 |
| Alerts          | Not the dashboard specification’s main focus | First-class portable Alert IR                              |
| Results         | Datasource-specific responses                | Normalized typed data frames                               |

## 3. Design principles

### 3.1 Perses-compatible visualization

Do not fork Perses syntax unnecessarily.

OpenPlait should be able to:

* Import a Perses dashboard
* Export a Perses-compatible dashboard
* Reuse Perses panel-plugin conventions
* Eventually render compatible dashboards in Perses or OpenLIT
* Add OpenPlait extensions without breaking the base resource

### 3.2 Query-neutral, not query-language replacement

A single universal query language will not represent every capability of SQL, PromQL, LogQL, and TraceQL without becoming extremely complex.

Use two query modes:

```yaml
mode: semantic
```

for portable queries, and:

```yaml
mode: native
```

for backend-specific advanced queries.

### 3.3 Typed intermediate results

Every adapter should return a normalized result format. Dashboards and transformations must not consume raw Prometheus, Loki, Tempo, or ClickHouse response formats.

### 3.4 Capability-aware portability

Datasource portability should never be implied when the target datasource cannot perform the operation.

Every adapter must expose its capabilities:

```yaml
capabilities:
  signals:
    - metrics
    - logs
    - traces
    - tabular
  operations:
    - filter
    - aggregate
    - group
    - percentile
    - rate
    - histogram
  joins:
    local: true
    crossDatasource: false
```

### 3.5 Extensions over lowest-common-denominator design

The core IR should contain operations that are common and well understood. Backend-specific capabilities should use namespaced extensions rather than polluting the core standard.

```yaml
extensions:
  io.openplait.clickhouse:
    settings:
      max_execution_time: 30
```

## 4. Proposed monorepo

Use a TypeScript-first monorepo because OpenLIT is primarily consuming it from a Next.js and Node.js application.

```text
openplait/
├── typescript/                 # npm workspaces (@openplait/*)
│   └── packages/
│       ├── core/
│       ├── adapter-sdk/
│       ├── adapter-clickhouse/
│       ├── adapter-tempo/
│       ├── adapter-loki/
│       ├── adapter-prometheus/
│       ├── adapter-jaeger/
│       ├── runtime/
│       └── perses/
├── python/                     # Poetry package (openplait on PyPI)
├── docs/
├── examples/
├── specifications/
├── rfcs/
└── test/
```


## 5. NPM package structure

Start with a limited number of packages. Do not publish twenty packages in the first release.

### Initial packages

```text
@openplait/core
@openplait/runtime
@openplait/adapter-clickhouse
@openplait/perses
@openplait/testing
```

Responsibilities:

### `@openplait/core`

Contains only portable definitions:

* Query IR
* Result model
* Transformation IR
* Visualization types
* Dashboard extensions
* Alert IR
* JSON Schema
* Validation
* Serialization
* Version metadata

It must not include:

* Database clients
* React
* OpenLIT code
* Secrets
* Network execution
* Backend-specific SDKs

### `@openplait/runtime`

Contains:

* Datasource registration
* Adapter resolution
* Query execution
* Transformation execution
* Result caching hooks
* Cancellation
* Timeouts
* Query planning
* Observability hooks

### `@openplait/adapter-clickhouse`

The first production adapter, with OpenLIT as its initial consumer:

* Semantic Query IR to ClickHouse SQL compiler
* Native SQL execution
* Parameter binding
* OpenTelemetry schema mappings
* Result normalization
* Capability declaration
* Explain support

### `@openplait/perses`

Contains:

* Perses model compatibility
* Perses import
* Perses export
* Panel-plugin mappings
* Layout mapping
* Variable mapping
* Validation against supported Perses constructs

### `@openplait/testing`

Contains:

* Adapter contract tests
* Query fixtures
* Expected compiled-query snapshots
* Result normalization fixtures
* Conformance helpers

Later, add Prometheus, Loki, Tempo, SQL and Elasticsearch adapters.

## 6. Resource envelope

Follow the declarative resource style used by Perses.

```yaml
apiVersion: openplait.io/v1alpha1
kind: Dashboard
metadata:
  name: ai-reliability-overview
  displayName: AI Reliability Overview
  labels:
    product: openlit
spec:
  datasources: {}
  variables: []
  panels: {}
  layouts: []
  duration: 1h
  refreshInterval: 30s
```

The base dashboard syntax should be as close to Perses as practical.

OpenPlait-specific behavior should be added through typed query, transform, result, and alert resources rather than changing basic dashboard composition.

## 7. Query IR

### 7.1 Query envelope

```yaml
apiVersion: openplait.io/v1alpha1
kind: Query
metadata:
  name: average-model-latency
spec:
  mode: semantic
  datasource:
    kind: ClickHouseDatasource
    name: openlit-clickhouse

  input:
    signal: traces
    entity: spans

  timeRange:
    field: timestamp
    from: ${__from}
    to: ${__to}

  select:
    - field: model
      as: model

    - aggregate:
        function: avg
        field: duration
      as: average_latency

  where:
    and:
      - field: service.name
        operator: equals
        value: ${service}

  groupBy:
    - field: model

  orderBy:
    - field: average_latency
      direction: desc

  limit: 20
```

### 7.2 Core query operations

Version one should support:

* Select fields
* Filter expressions
* Aggregations
* Grouping
* Ordering
* Limits
* Time bucketing
* Rates
* Percentiles
* Distinct count
* Histograms
* Basic arithmetic expressions
* Aliases
* Parameters
* Optional joins for SQL-capable adapters

Avoid adding complex window functions, subqueries, recursive expressions, and arbitrary user-defined functions to the portable core initially.

### 7.3 Expression tree

Do not use raw query strings for portable filters.

```ts
type BooleanExpression =
  | {
      and: BooleanExpression[];
    }
  | {
      or: BooleanExpression[];
    }
  | {
      not: BooleanExpression;
    }
  | ComparisonExpression;
```

Example:

```yaml
where:
  and:
    - field: status.code
      operator: notEquals
      value: UNSET

    - or:
        - field: model
          operator: equals
          value: gpt-5

        - field: model
          operator: equals
          value: claude
```

### 7.4 Native query escape hatch

```yaml
apiVersion: openplait.io/v1alpha1
kind: Query
metadata:
  name: expensive-traces-native
spec:
  mode: native
  datasource:
    kind: ClickHouseDatasource
    name: openlit-clickhouse

  native:
    language: sql
    statement: |
      SELECT
        SpanAttributes['gen_ai.request.model'] AS model,
        sum(toFloat64OrZero(SpanAttributes['gen_ai.usage.cost'])) AS cost
      FROM otel_traces
      WHERE Timestamp BETWEEN {from:DateTime64} AND {to:DateTime64}
      GROUP BY model

    parameters:
      from: ${__from}
      to: ${__to}
```

Native mode must always use bound parameters. User values should never be interpolated directly into SQL or other query strings.

## 8. Semantic field model

The key to portability is not only syntax. It is a stable semantic field catalogue.

OpenPlait should define canonical fields such as:

```text
timestamp
duration
service.name
service.namespace
deployment.environment
trace.id
span.id
span.name
span.kind
status.code
log.severity
log.body
metric.name
metric.value
gen_ai.system
gen_ai.request.model
gen_ai.usage.input_tokens
gen_ai.usage.output_tokens
gen_ai.usage.cost
```

Datasource adapters map these canonical fields onto physical storage.

For ClickHouse:

```yaml
fieldMappings:
  timestamp:
    expression: Timestamp

  duration:
    expression: Duration

  service.name:
    expression: ResourceAttributes['service.name']

  gen_ai.request.model:
    expression: SpanAttributes['gen_ai.request.model']
```

This field-mapping layer lets OpenLIT change its ClickHouse schema later without changing dashboard definitions.

## 9. Normalized result model

The most important boundary is between adapters and consumers.

Use a dataframe-style response:

```ts
interface DataFrame {
  name?: string;
  fields: DataField[];
  length: number;
  metadata?: FrameMetadata;
}

interface DataField {
  name: string;
  type:
    | "string"
    | "number"
    | "boolean"
    | "time"
    | "duration"
    | "trace"
    | "json";

  values: unknown[];
  labels?: Record<string, string>;
  unit?: string;
}
```

Example:

```json
{
  "frames": [
    {
      "name": "average_latency_by_model",
      "length": 2,
      "fields": [
        {
          "name": "model",
          "type": "string",
          "values": ["gpt-5", "claude"]
        },
        {
          "name": "average_latency",
          "type": "number",
          "unit": "ms",
          "values": [860, 710]
        }
      ]
    }
  ]
}
```

Every adapter must normalize its backend response into this format.

This makes the renderer independent of whether the source was Prometheus, Tempo, Loki or ClickHouse.

## 10. Transformation IR

Transformations should run on normalized frames, not against backend-specific responses.

### Initial transformation operators

* Filter rows
* Select fields
* Rename fields
* Calculate field
* Sort
* Limit
* Group and reduce
* Join frames
* Merge frames
* Pivot
* Unpivot
* Convert units
* Fill missing values
* Window calculation
* Labels-to-fields
* Extract JSON property

Example:

```yaml
transformations:
  - kind: FilterRows
    spec:
      condition:
        field: cost
        operator: greaterThan
        value: 0

  - kind: CalculateField
    spec:
      as: cost_per_request
      expression:
        divide:
          - field: total_cost
          - field: request_count

  - kind: Sort
    spec:
      by:
        field: cost_per_request
        direction: desc
```

### Execution placement

Every transformation should declare where it may execute:

```yaml
execution:
  preference: auto
```

Supported values:

* `source`: push down into the datasource
* `runtime`: execute in OpenPlait
* `client`: execute in the browser
* `auto`: planner chooses

For example, filtering and aggregation should normally be pushed into ClickHouse. Joining a ClickHouse result with Prometheus data may need to happen in the runtime.

## 11. Visualization specification

The visualization layer should remain closely aligned with Perses.

Perses panels use a plugin object containing `kind` and `spec`, and queries are separately declared within the panel.

OpenPlait panel:

```yaml
kind: Panel
spec:
  display:
    name: Model Cost
    description: Total AI cost grouped by model

  plugin:
    kind: TimeSeriesChart
    spec:
      legend:
        position: bottom
      yAxis:
        unit: currencyUSD
        min: 0

  queries:
    - kind: OpenPlaitQuery
      spec:
        queryRef:
          $ref: "#/spec/queries/model-cost"

  transformations:
    - kind: RenameFields
      spec:
        mappings:
          value: Cost
```

### Initial visualizations

Support a small common set:

* Time series
* Stat
* Gauge
* Bar chart
* Pie chart
* Table
* Histogram
* Heatmap
* Logs
* Trace list
* Markdown

Avoid trying to standardize every visualization property in version one.

Split configuration into:

```yaml
spec:
  dataMapping: {}
  display: {}
  interactions: {}
  extensions: {}
```

This prevents visual styling from becoming mixed with semantic data mapping.

## 12. Dashboard specification

Use the Perses pattern:

```yaml
apiVersion: openplait.io/v1alpha1
kind: Dashboard
metadata:
  name: clickhouse-observability
spec:
  display:
    name: AI Observability
    description: AI reliability and cost overview

  datasources:
    primary:
      default: true
      plugin:
        kind: ClickHouseDatasource
        spec:
          connectionRef: clickhouse-primary
    archive:
      plugin:
        kind: ClickHouseDatasource
        spec:
          connectionRef: clickhouse-archive

  variables:
    - kind: ListVariable
      spec:
        name: service
        display:
          name: Service
        plugin:
          kind: OpenPlaitVariableQuery
          spec:
            queryRef:
              $ref: "#/spec/queries/services"

  queries:
    request-rate:
      kind: Query
      spec:
        mode: semantic
        # ...

  panels:
    request-rate-chart:
      kind: Panel
      spec:
        display:
          name: Request Rate
        plugin:
          kind: TimeSeriesChart
          spec: {}
        queries:
          - kind: OpenPlaitQuery
            spec:
              queryRef:
                $ref: "#/spec/queries/request-rate"

  layouts:
    - kind: Grid
      spec:
        items:
          - x: 0
            y: 0
            width: 12
            height: 6
            content:
              $ref: "#/spec/panels/request-rate-chart"

  duration: 1h
  refreshInterval: 30s
```

Perses supports dashboard-local, project-level and global datasource scopes, with narrower scopes overriding broader ones.

OpenPlait can adopt the same concept but simplify the first OpenLIT integration:

```text
dashboard
workspace
global
```

OpenLIT can initially implement only dashboard and organization scope.

## 13. Alert IR

Alerts must not be tied directly to dashboard panels.

A dashboard panel may reference an alert, but the alert should be independently executable.

```yaml
apiVersion: openplait.io/v1alpha1
kind: AlertRule
metadata:
  name: high-ai-cost
spec:
  query:
    kind: Query
    spec:
      mode: semantic
      datasource:
        kind: ClickHouseDatasource
        name: primary
      input:
        signal: traces
        entity: otel.spans
      select:
        - aggregate:
            function: sum
            field: gen_ai.usage.cost
          as: total_cost

  condition:
    field: total_cost
    reducer: last
    operator: greaterThan
    threshold: 100

  evaluation:
    every: 5m
    lookback: 1h
    for: 10m
    noDataState: no_data
    errorState: error

  labels:
    severity: warning
    team: ai-platform

  annotations:
    summary: AI cost exceeded $100 in one hour

  notifications:
    - channelRef: default-operations
```

### Alert lifecycle states

Standardize:

```text
normal
pending
firing
no_data
error
suppressed
```

### Alert features to delay

Do not include these in the first release:

* Complex incident management
* Escalation schedules
* On-call management
* Alert correlation
* Anomaly models
* Notification delivery implementations

OpenPlait should specify the alert; OpenLIT or another engine should execute and deliver it.

## 14. Datasource adapter SDK

Define a strict adapter contract:

```ts
export interface DatasourceAdapter<
  TConfig = unknown,
  TCompiledQuery = unknown
> {
  readonly manifest: AdapterManifest;

  validateConfig(config: TConfig): ValidationResult;

  getCapabilities(
    config: TConfig
  ): Promise<DatasourceCapabilities>;

  compile(
    query: SemanticQuery,
    context: CompileContext
  ): Promise<CompiledQuery<TCompiledQuery>>;

  execute(
    query: CompiledQuery<TCompiledQuery> | NativeQuery,
    context: ExecutionContext
  ): Promise<QueryResult>;

  explain?(
    query: SemanticQuery,
    context: CompileContext
  ): Promise<QueryExplanation>;

  discoverSchema?(
    context: DiscoveryContext
  ): Promise<SemanticSchema>;
}
```

Adapter manifest:

```yaml
name: clickhouse
displayName: ClickHouse
version: 0.1.0
queryLanguages:
  - openplait-semantic
  - sql
signals:
  - traces
  - logs
  - metrics
  - tabular
capabilities:
  filter: true
  aggregate: true
  percentile: true
  rate: true
  histogram: true
  join: true
  fullTextSearch: false
```

## 15. ClickHouse adapter strategy for OpenLIT

This should be the first reference adapter.

### Phase-one mappings

Support:

* `otel_traces`
* `otel_logs`
* OpenTelemetry metrics tables
* `openlit_evaluation`
* OpenLIT-specific application tables

Create logical datasets:

```text
otel.spans
otel.logs
otel.metrics.gauge
otel.metrics.sum
otel.metrics.histogram
openlit.evaluations
openlit.exceptions
openlit.costs
```

Each dataset owns:

* Physical table
* Timestamp field
* Field mappings
* Default filters
* Supported aggregations
* Units
* Required tenant conditions
* Query safety rules

Example:

```yaml
datasets:
  otel.spans:
    table: otel_traces
    timeField: Timestamp
    fields:
      trace.id:
        expression: TraceId
        type: string

      duration:
        expression: Duration
        type: duration
        unit: ns

      service.name:
        expression: ResourceAttributes['service.name']
        type: string

      gen_ai.request.model:
        expression: SpanAttributes['gen_ai.request.model']
        type: string
```

### Mandatory safety

The adapter must enforce:

* Bound values
* Identifier allowlists
* Maximum result rows
* Query timeout
* Tenant filters
* Date-range limits
* Read-only execution
* No multiple SQL statements
* No arbitrary table access in semantic mode
* Query cancellation
* Audit metadata

## 16. Runtime query planner

The runtime should use this sequence:

```text
1. Validate resource
2. Resolve variables
3. Resolve datasource
4. Load datasource capabilities
5. Resolve semantic field mappings
6. Validate operation support
7. Split source and runtime transformations
8. Compile semantic query
9. Execute adapter query
10. Normalize result
11. Execute remaining transformations
12. Validate result contract
13. Return frames and execution metadata
```

Execution metadata:

```json
{
  "metadata": {
    "datasource": "clickhouse",
    "adapterVersion": "0.1.0",
    "executionTimeMs": 48,
    "rowsRead": 210000,
    "rowsReturned": 20,
    "cache": "miss",
    "warnings": []
  }
}
```

## 17. OpenLIT integration plan

Do not rewrite the entire OpenLIT dashboard system at once.

### Integration boundary

Create an OpenLIT service:

```text
OpenLIT UI
   │
   ▼
OpenLIT Dashboard API
   │
   ▼
OpenPlait Runtime
   │
   ▼
ClickHouse adapter
```

Do not initially allow the browser to connect directly to ClickHouse, Prometheus, Loki, or Tempo.

### Compatibility with current widgets

Create a translation layer:

```ts
function legacyWidgetToOpenPlait(
  widget: OpenLITWidget
): OpenPlaitPanel;
```

This lets existing dashboards continue working while newly saved widgets use OpenPlait.

### Suggested rollout

#### Stage 1: Read-only prototype

Implement one dashboard with:

* One ClickHouse datasource
* Time series
* Stat
* Table
* Semantic filters
* Grouping
* Aggregation
* Variables
* Grid layout

#### Stage 2: Dual-read mode

OpenLIT loads:

* Legacy widget format for existing dashboards
* OpenPlait format for newly created test dashboards

#### Stage 3: Dual-write mode

When a supported existing widget is saved:

* Save current OpenLIT format
* Generate and save OpenPlait representation
* Compare output in tests

#### Stage 4: OpenPlait primary

OpenLIT stores OpenPlait dashboard documents and derives legacy models only where required.

#### Stage 5: External datasource adapters

Add:

1. Prometheus
2. Loki
3. Tempo
4. Generic SQL
5. Elasticsearch or OpenSearch

## 18. Perses compatibility module

Define three compatibility levels.

### Level 1: Structural compatibility

OpenPlait supports:

* Dashboard resource
* Display metadata
* Datasources
* Variables
* Panels
* Grid layouts
* Duration
* Refresh interval

### Level 2: Visualization compatibility

OpenPlait maps supported panels onto Perses plugin kinds:

```text
OpenPlait TimeSeries → Perses TimeSeriesChart
OpenPlait Stat       → Perses StatChart
OpenPlait Table      → Perses Table
OpenPlait Gauge      → Perses GaugeChart
```

### Level 3: Round-trip compatibility

For the supported subset:

```text
Perses YAML
   → OpenPlait
   → Perses YAML
```

should preserve the semantic dashboard definition.

Unknown plugin configuration should be preserved in an extension envelope where possible:

```yaml
extensions:
  org.perses:
    originalPlugin:
      kind: SomePersesPlugin
      spec: {}
```

## 19. Schema and validation approach

Publish schemas in at least two forms:

* JSON Schema for ecosystem compatibility
* TypeScript types for OpenLIT

Consider CUE later because Perses already publishes CUE representations alongside Go and TypeScript implementations.

Validation layers:

```text
Syntax validation
    ↓
Resource-schema validation
    ↓
Reference validation
    ↓
Semantic query validation
    ↓
Datasource capability validation
    ↓
Security policy validation
```

Example validation errors:

```json
{
  "errors": [
    {
      "code": "UNSUPPORTED_OPERATION",
      "path": "spec.select[1].aggregate.function",
      "message": "Datasource tempo-main does not support avg aggregation for trace search."
    }
  ]
}
```

## 20. Versioning and migrations

Use:

```yaml
apiVersion: openplait.io/v1alpha1
```

Version resources independently where necessary, but keep one initial API version across core resources to reduce complexity.

Rules:

* Patch releases cannot alter valid document meaning
* Minor releases may add optional properties
* Breaking schema changes require a new API version
* Every breaking release must provide deterministic migrations
* Unknown fields should be retained where possible
* Adapters version independently of the core specification
* Dashboard documents should record only the specification version, not npm package versions

CLI:

```bash
openplait validate dashboard.yaml
openplait migrate dashboard.yaml --to openplait.io/v1beta1
openplait compile dashboard.yaml --datasource clickhouse
openplait import-perses dashboard.yaml
openplait export-perses dashboard.yaml
```

## 21. Conformance tests

An open standard needs conformance tests, not only TypeScript interfaces.

### Adapter conformance

Every adapter must pass:

* Filter compilation
* Boolean-expression compilation
* Aggregation
* Grouping
* Time range
* Parameter safety
* Empty result
* Null handling
* Type conversion
* Cancellation
* Timeout
* Result normalization
* Capability rejection

### Visualization conformance

Render fixtures should verify:

* Required field roles
* Unit handling
* Missing values
* Multiple frames
* Labels
* Time ordering
* Transformation output

### Perses conformance

Maintain fixtures for:

* Importing supported Perses dashboards
* Exporting compatible dashboards
* Preserving panel references
* Preserving layouts
* Preserving variables
* Preserving datasource selectors

## 22. Recommended implementation sequence

### Milestone 1: Specification foundation

Deliver:

* Repository and governance
* `apiVersion`, `kind`, `metadata`, `spec`
* Query IR
* DataFrame result format
* JSON Schema
* TypeScript types
* Validator
* Example documents

### Milestone 2: ClickHouse reference implementation

Deliver:

* Adapter SDK
* ClickHouse adapter
* OpenLIT semantic schema
* Query compiler
* Bound parameters
* Result normalization
* Adapter conformance tests

### Milestone 3: Dashboard and Perses compatibility

Deliver:

* Perses dashboard import
* OpenPlait dashboard model
* Grid layout
* Variables
* Time series, stat and table panels
* Application-neutral renderer bindings consumable by OpenLIT

### Milestone 4: Transformation runtime

Deliver:

* Runtime planner
* Core transforms
* Source pushdown
* Multi-query execution
* Frame joining
* Query cancellation
* Execution metadata

### Milestone 5: Alert IR

Deliver:

* Alert resource schema
* Evaluation model
* OpenLIT ClickHouse evaluator
* State transitions
* Existing OpenLIT notification integration

### Milestone 6: Additional adapters

Deliver in this order:

1. Prometheus
2. Loki
3. Tempo
4. Generic SQL
5. Elasticsearch/OpenSearch

## 23. First production scope

The first production release should deliberately support only:

```text
Datasource:
  ClickHouse

Queries:
  select
  filter
  aggregate
  group
  time bucket
  percentile
  order
  limit

Transformations:
  filter
  rename
  calculate
  reduce
  sort
  join
  labels-to-fields

Visualizations:
  time series
  stat
  table
  bar chart

Dashboard:
  grid layout
  variables
  dashboard-local datasources
  duration
  refresh interval

Alerts:
  threshold
  reduce
  evaluation interval
  pending duration
```

This is enough to prove the abstraction inside OpenLIT without attempting to standardize the whole analytics ecosystem upfront.

## 24. Main architectural decision

The strongest architecture is:

```text
Perses-compatible dashboard and visualization model
                         +
OpenPlait semantic Query IR
                         +
OpenPlait normalized DataFrame result
                         +
OpenPlait Transformation IR
                         +
OpenPlait Alert IR
                         +
Datasource adapter SDK
```

This lets OpenPlait complement Perses rather than compete with it:

> **Perses provides a strong open foundation for portable dashboard composition and visualization. OpenPlait extends that model downward into portable query execution and upward into portable transformations and alerting.**

For OpenLIT, begin with `@openplait/core`, `@openplait/runtime`, `@openplait/adapter-clickhouse`, and `@openplait/perses`. The first success criterion should be that one OpenLIT dashboard can run unchanged against two logically equivalent datasource mappings while producing the same normalized frames and visual output.

## 25. Implementation status

### Milestone 1: Specification foundation — complete

- [x] Repository scaffold and governance documents
- [x] `openplait.io/v1alpha1` resource envelope
- [x] Semantic and native Query IR TypeScript types
- [x] Normalized DataFrame result types
- [x] Draft 2020-12 JSON Schemas
- [x] Structural and cross-field validators
- [x] JSON/YAML parsing and serialization
- [x] Semantic query, native query, and normalized result examples
- [x] Type checking, contract tests, production build, and package import smoke test

### Milestone 2: ClickHouse reference implementation — complete

- [x] Portable datasource adapter SDK and typed error contract
- [x] ClickHouse adapter manifest and capability declaration
- [x] Generic OpenTelemetry mappings plus optional OpenLIT dataset presets
- [x] Allowlisted semantic SQL compiler with bound parameters
- [x] Filters, aggregation, grouping, time buckets, ordering, limits, rate,
      percentile, distinct count, histogram, and arithmetic
- [x] Tenant predicates, time-range enforcement, row limits, timeouts, read-only
      settings, cancellation, and audit query IDs
- [x] Native SQL escape hatch with explicit administrator opt-in
- [x] DataFrame normalization, schema discovery, and explain support
- [x] ClickHouse adapter conformance tests and compilation examples

### Milestone 3: Dashboard and Perses compatibility — complete

- [x] Perses-aligned OpenPlait Dashboard resource and JSON Schema
- [x] Dashboard-local datasources, text/list variables, panels, and grid layouts
- [x] Named datasource bindings, cross-resource references, repeat variables,
      defaults, and grid validation
- [x] Time series, stat, and table visualization specifications
- [x] Perses YAML/JSON import and export with supported-subset round trips
- [x] Embedded OpenPlait query reconstruction across Perses export/import
- [x] Preservation diagnostics for unsupported visualization plugins
- [x] Application-neutral dashboard, panel, query, and grid renderer bindings
- [x] Generic multi-datasource ClickHouse and Perses fixtures and conformance tests

### Milestone 4: Transformation runtime — complete

- [x] Versioned TransformationPipeline resource, TypeScript types, and JSON Schema
- [x] Panel-local transformations with Perses extension round-trip preservation
- [x] Scoped, application-neutral datasource registry supporting named instances
- [x] Capability-aware source/runtime/client transformation planning
- [x] Safe ClickHouse filter, ordering, and limit pushdown
- [x] Concurrent multi-query execution and normalized frame validation
- [x] Filter, select, rename, calculate, sort, limit, group/reduce, join, merge,
      pivot, unpivot, unit conversion, missing-value, window, label, and JSON transforms
- [x] Cross-datasource frame joins and client-deferred transformations
- [x] Cancellation, timeouts, cache hooks, lifecycle hooks, and execution metadata
- [x] ClickHouse integration and transformation conformance tests

### Milestone 5: Alert IR and evaluation — complete

- [x] Versioned, independently executable AlertRule resource and JSON Schema
- [x] Embedded portable query and normalized-frame transformation pipeline
- [x] Field reduction and threshold comparison model
- [x] Evaluation cadence, lookback, hold duration, no-data, and error policies
- [x] Normal, pending, firing, no-data, error, and suppressed lifecycle states
- [x] Pluggable alert state store with serialized per-rule evaluation
- [x] Firing, resolved, error, and no-data notification intents without delivery coupling
- [x] Host-controlled suppression, scheduling calculation, cancellation, and audit context
- [x] ClickHouse-backed AlertRule execution through the generic runtime
- [x] Alert resource, lifecycle, and ClickHouse conformance tests

### Milestone 6A: Tempo stabilization — complete (2026-08-06)

- [x] Structured, redacted HTTP diagnostics with status, response body, endpoint,
      query shape, and request identifiers
- [x] Build/version inspection with conservative capability negotiation and a
      managed-service search fallback when build metadata is unavailable
- [x] Minimal compatible TraceQL search with version-gated `most_recent` and a
      one-step compatibility retry that never removes required filters
- [x] Configured and server-learned search limits, chunked metrics windows, and
      capability-driven OpenLIT time-range controls
- [x] Native Tempo trace IDs, span IDs, parent IDs, attributes, events, and links
      normalized into OpenPlait frames
- [x] Strict signal routing with no implicit ClickHouse read or materialization
      fallback when Tempo is selected
- [x] Unit, regression, and pinned `grafana/tempo:2.8.2` Docker integration tests
- [x] OpenLIT connector form and telemetry filter UI driven by source capabilities

### Milestone 6B: Prometheus and Loki — complete (2026-08-07)

- [x] Shared HTTP adapter SDK validation, authentication, timeout, cancellation,
      request identity, bounded-range, and structured error behavior
- [x] Prometheus semantic and native PromQL range execution with normalized
      matrix/vector/scalar frames and metric/label discovery
- [x] Loki semantic and native LogQL range execution with normalized stream and
      metric frames and label discovery
- [x] Named-datasource runtime routing with no cross-connector fallback
- [x] OpenLIT selected-signal factories for Loki logs and Prometheus metrics,
      guarded by the existing SSRF-safe transport and vault boundary
- [x] Descriptor-driven connector forms, capability declarations, discovery,
      and mocked upstream regression coverage
