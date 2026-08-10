# `@openplait/perses`

Perses dashboard import/export and application-neutral renderer bindings for
OpenPlait. OpenLIT can consume these models, but no API depends on OpenLIT.

The first compatibility surface supports dashboard-local datasources, text and
list variables, grid layouts, links, and the `TimeSeriesChart`, `StatChart`, and
`Table` visualization plugins. Other plugin kinds are retained during an
import/export round trip and reported as renderer warnings.

OpenPlait query definitions are embedded in Perses query plugins on export and
reconstructed as dashboard query references on import. This keeps the Perses
document self-contained without discarding the portable Query IR.

Panel transformations are exposed to renderer consumers and encoded in a
namespaced extension during Perses export, then restored during import.

```ts
import {
  createDashboardRenderModel,
  parsePersesDashboard,
  serializePersesDashboard,
} from "@openplait/perses";

const dashboard = parsePersesDashboard(persesYaml);
const renderModel = createDashboardRenderModel(dashboard);
const exported = serializePersesDashboard(dashboard, "yaml", {
  project: "observability",
});
```

Datasource plugins remain declarative. For the current implementation, use a
`ClickHouseDatasource`; credentials stay in the consuming application's
server-side connection registry, not in dashboard YAML. A dashboard can declare
multiple named ClickHouse datasource instances and bind each query to one by
name. Future adapter kinds can use the same map without changing the dashboard
composition model.
