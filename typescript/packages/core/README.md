# `@openplait/core`

Portable OpenPlait definitions with no database client, network execution,
renderer, or application dependency.

## Included in `v1alpha1`

- `Query` resources in semantic and native modes
- `Dashboard` resources with datasources, variables, panels, and grid layouts
- Time series, stat, and table visualization specifications
- Standalone and panel-local Transformation IR with execution preferences
- Independently executable AlertRule resources and lifecycle policy types
- Recursive boolean filters and arithmetic value expressions
- Select, aggregate, group, time bucket, order, limit, and basic join types
- Normalized `QueryResult`, `DataFrame`, and `DataField` types
- JSON Schemas for Query, Dashboard, TransformationPipeline, and AlertRule
  resources and normalized results
- Structural and cross-field validation
- JSON and YAML parsing/serialization
- Specification and API version constants

## Usage

```ts
import {
  OPENPLAIT_API_VERSION,
  parseDashboard,
  parseQuery,
  validateQueryResult,
  type SemanticQuery,
} from "@openplait/core";

const query: SemanticQuery = {
  apiVersion: OPENPLAIT_API_VERSION,
  kind: "Query",
  metadata: { name: "requests-by-model" },
  spec: {
    mode: "semantic",
    datasource: { kind: "ClickHouseDatasource", name: "primary" },
    input: { signal: "traces", entity: "otel.spans" },
    select: [
      { field: "gen_ai.request.model", as: "model" },
      { aggregate: { function: "count" }, as: "requests" },
    ],
    groupBy: [{ field: "gen_ai.request.model" }],
  },
};

const parsed = parseQuery(queryYamlSource);
const dashboard = parseDashboard(dashboardYamlSource);
const result = validateQueryResult(adapterOutput);
```

The schemas are exported from JavaScript as `schemas` and as package files
under `@openplait/core/schemas/v1alpha1/*`.

JSON Schema verifies document structure. The runtime validator additionally
checks invariants JSON Schema cannot express cleanly, including unique query
output names, named dashboard datasource bindings, dashboard reference
integrity, grid bounds, and dataframe field lengths matching their frame
length. Datasource plugin kinds remain open-ended; ClickHouse is simply the
first implemented adapter.
