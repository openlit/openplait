# `@openplait/adapter-prometheus`

Prometheus-compatible metrics adapter with bounded PromQL range execution, semantic label filters, normalized frames, label discovery, and support for Prometheus-compatible services such as Mimir.

```ts
const adapter = new PrometheusAdapter({ url: "http://localhost:9090", allowNativeQueries: true });
const result = await adapter.execute(nativePromQlQuery, executionContext);
```
