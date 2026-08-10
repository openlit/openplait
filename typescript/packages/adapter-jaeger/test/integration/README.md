# Local Jaeger for adapter development

```bash
cd typescript/packages/adapter-jaeger/test/integration
docker compose up -d

# UI: http://localhost:16686
# OTLP HTTP: http://localhost:4318
```

Seed a sample OTLP trace (requires `curl`):

```bash
./seed-traces.sh
```

Then:

```bash
curl -s 'http://localhost:16686/api/services' | jq
```
