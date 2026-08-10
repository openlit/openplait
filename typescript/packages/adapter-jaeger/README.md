# @openplait/adapter-jaeger

Portable Jaeger Query HTTP adapter for OpenPlait semantic and native trace reads.

## Capabilities

- `GET /api/services` — service discovery / health
- `GET /api/traces?service=&start=&end=&limit=` — bounded search (timestamps in µs)
- `GET /api/traces/{id}` — full trace with span logs → events
- Automatic `/jaeger` path fallback when the base URL is a reverse-proxy root

Jaeger cannot push down OR-of-AND AI selectors or server aggregation. Hosts
(OpenLIT) sample + filter in-process.

## Install

```bash
npm install @openplait/adapter-jaeger
```

## Quick use

```ts
import { JaegerAdapter } from "@openplait/adapter-jaeger";

const adapter = new JaegerAdapter({ url: "http://localhost:16686" });
const services = await adapter.listServices();
const traces = await adapter.searchTraces({
  service: services[0],
  startMs: Date.now() - 3_600_000,
  endMs: Date.now(),
  limit: 20,
});
```

## Local stack

See `test/integration/docker-compose.yml` for Jaeger all-in-one with OTLP.
