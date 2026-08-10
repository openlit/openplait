# `@openplait/adapter-loki`

Grafana Loki logs adapter with bounded LogQL range execution, semantic stream and line filters, normalized frames, and label discovery.

```ts
const adapter = new LokiAdapter({ url: "http://localhost:3100", allowNativeQueries: true });
const result = await adapter.execute(nativeLogQlQuery, executionContext);
```
