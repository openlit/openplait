# `@openplait/runtime`

Application-neutral query planning, datasource resolution, execution, and
normalized-frame transformations for OpenPlait.

The runtime validates queries, resolves named datasource instances, checks
adapter capabilities, safely pushes a leading transformation prefix to the
source, executes queries concurrently, applies runtime transforms, and returns
client-deferred transforms with detailed execution metadata.

## Multiple datasource instances

Applications own adapter construction and credentials. The registry contains
only server-side instances; dashboards and queries refer to them by name and
kind.

```ts
import { ClickHouseAdapter } from "@openplait/adapter-clickhouse";
import { DatasourceRegistry, OpenPlaitRuntime } from "@openplait/runtime";

const primaryConfig = {
  url: process.env.PRIMARY_CLICKHOUSE_URL!,
  username: process.env.PRIMARY_CLICKHOUSE_USER,
  password: process.env.PRIMARY_CLICKHOUSE_PASSWORD,
};
const archiveConfig = {
  url: process.env.ARCHIVE_CLICKHOUSE_URL!,
  username: process.env.ARCHIVE_CLICKHOUSE_USER,
  password: process.env.ARCHIVE_CLICKHOUSE_PASSWORD,
};

const datasources = new DatasourceRegistry()
  .register({
    name: "primary",
    kind: "ClickHouseDatasource",
    scope: "dashboard",
    config: primaryConfig,
    adapter: new ClickHouseAdapter(primaryConfig),
  })
  .register({
    name: "archive",
    kind: "ClickHouseDatasource",
    scope: "dashboard",
    config: archiveConfig,
    adapter: new ClickHouseAdapter(archiveConfig),
  });

const runtime = new OpenPlaitRuntime(datasources, {
  defaultTimeoutMs: 30_000,
  hooks: {
    onQueryStart: ({ original }) => logger.info({ query: original.metadata.name }),
  },
});

const response = await runtime.execute({
  queries,
  transformations,
  variables,
  audit: { requestId, actorId, tenantId },
  abortSignal: request.signal,
});
```

OpenLIT can build this registry from its datasource records. Nothing in the
runtime depends on OpenLIT, React, a particular secret store, or a specific
datasource kind.

## Transformation placement

- `source`: must be pushed down or planning fails.
- `runtime`: always runs against normalized frames.
- `client`: is returned in `deferredTransformations` for the consumer.
- `auto`: pushes only when every selected adapter supports the operation and
  the rewrite preserves semantics.

The initial safe ClickHouse pushdown set is row filtering for direct-field
queries, ordering, and limiting. Other transformations execute in the runtime.

## Implemented transforms

`FilterRows`, `SelectFields`, `RenameFields`, `CalculateField`, `Sort`, `Limit`,
`GroupAndReduce`, `JoinFrames`, `MergeFrames`, `Pivot`, `Unpivot`, `ConvertUnit`,
`FillMissing`, `WindowCalculation`, `LabelsToFields`, and
`ExtractJsonProperty`.

The optional cache is supplied by the host application. Lifecycle hooks expose
plans, query start/completion, and errors without imposing an observability SDK.

## Alert evaluation

`AlertEvaluator` executes an AlertRule through the same datasource registry and
transformation runtime. It reduces the selected numeric field, evaluates the
threshold, and persists lifecycle state through a host-provided `AlertStateStore`.

```ts
import { AlertEvaluator, InMemoryAlertStateStore } from "@openplait/runtime";

const alerts = new AlertEvaluator(runtime, {
  stateStore: new InMemoryAlertStateStore(), // Replace in production.
});

const evaluation = await alerts.evaluate(rule, {
  audit: { requestId, actorId, tenantId },
  abortSignal: request.signal,
});

for (const intent of evaluation.notifications) {
  await applicationNotificationService.deliver(intent);
}
```

OpenPlait emits notification intents only. The consuming application owns the
durable store, scheduler, secrets, channel configuration, retries, and delivery.
