# `@openplait/adapter-tempo`

A generic Grafana Tempo adapter for OpenPlait. It compiles portable trace
filters to TraceQL, executes bounded searches through Tempo's HTTP API, and
normalizes trace summaries and full OTLP traces into OpenPlait dataframes.

The adapter is application-neutral. It has no OpenLIT schema assumptions;
consumers may register canonical names for their own resource, span, event, or
link attributes through `attributeFields`.

## Supported operations

- Semantic trace search against `tempo.trace_search`
- Recursive `and`, `or`, and `not` filters
- Equality, ordering, set, null, substring, prefix, suffix, and regex filters
- Newest-first timestamp ordering and bounded result limits
- Opt-in native TraceQL
- Trace-by-ID retrieval with OTLP-to-dataframe normalization
- Lowercase-hex normalization for OTLP base64 trace/span identifiers
- Tempo v2 tag discovery with automatic v1 compatibility fallback
- Version/capability inspection through `/api/status/buildinfo`
- TraceQL metrics range queries through normalized OpenPlait dataframes
- Tenant routing, bearer auth, basic auth, proxy headers, cancellation, and
  request/query timeouts

Tempo search returns trace summaries rather than complete spans. For that
reason, trace summary fields are selectable while span intrinsics and
attributes are filter-only. Call `getTrace()` for complete span rows.

Experimental search hints are never assumed for an unknown server. Provide a
known `tempoVersion`, explicitly set `enableMostRecent`, or call
`inspectServer()` during the datasource health check and reconstruct the
adapter with the resulting profile.

## Usage

```ts
import { TempoAdapter } from "@openplait/adapter-tempo";

const adapter = new TempoAdapter({
  url: "https://tempo.example.com",
  tenantId: "tenant-a",
  bearerToken: process.env.TEMPO_TOKEN,
  maxResultRows: 1_000,
  maxTimeRangeMs: 7 * 24 * 60 * 60 * 1_000,
  attributeFields: {
    "deployment.environment": {
      scope: "resource",
      attribute: "deployment.environment.name",
      type: "string",
    },
    "gen_ai.request.model": {
      scope: "span",
      attribute: "gen_ai.request.model",
      type: "string",
    },
  },
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
```

The semantic query must use signal `traces`, dataset `tempo.trace_search`, and
a `timestamp` time range. Its selectable summary fields are discoverable with
`discoverSchema()`. Built-in filter-only mappings include span name, span ID,
parent span ID, span kind, span status, span duration, and service name.

## Native TraceQL

Native mode is disabled by default. Enable it only in trusted server-side
configuration:

```ts
const adapter = new TempoAdapter({
  url: "https://tempo.example.com",
  allowNativeQueries: true,
});
```

Native queries use language `traceql` and must carry their bounds under the
`io.openplait.tempo` extension:

```ts
extensions: {
  "io.openplait.tempo": {
    timeRange: { from: "2026-08-05T00:00:00Z", to: "2026-08-05T01:00:00Z" },
    limit: 100,
    spansPerSpanSet: 20,
  },
}
```

## Trace details and discovery

`getTrace(traceId, context, range?)` fetches `/api/traces/<traceId>` and emits
one row per OTLP span, including resource attributes, span attributes, events,
status, duration, and identifiers.

`discoverTags(scope, context)` and
`discoverTagValues(tag, context, options?)` use Tempo's v2 discovery endpoints.
When the server version is not pinned, 400/404 responses retry through the
legacy v1 endpoints without weakening the requested tag or TraceQL filter.

`queryMetrics(range, context)` executes `/api/metrics/query_range` and emits
`timestamp`, `value`, and `labels` fields. Search and metrics window limits are
deployment settings, not universal Tempo constants; configure known limits in
the host application and split metrics windows where necessary.

HTTP failures are `AdapterError` instances whose structured `details` include
the upstream status/body and safe request diagnostics. Credentials and the full
query URL are not included.

Keep credentials in the host application's server-side connection registry;
never put them in dashboard or query resources.
