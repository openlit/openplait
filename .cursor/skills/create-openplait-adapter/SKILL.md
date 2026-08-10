---
name: create-openplait-adapter
description: >-
  Implement a custom OpenPlait DatasourceAdapter with @openplait/adapter-sdk:
  validateConfig, capabilities, compile, execute, normalize frames, errors, and
  tests. Use when building a new backend adapter, extending OpenPlait beyond
  shipped ClickHouse/Tempo/Loki/Prometheus/Jaeger packages, or reviewing adapter
  checklist compliance.
---

# Create an OpenPlait Adapter

Implement `DatasourceAdapter` from `@openplait/adapter-sdk`. Keep backend quirks
inside the package; return only portable `@openplait/core` dataframes.

## Checklist

1. **Manifest** — stable `kind`, version, human label.
2. **validateConfig** — URL, auth combinations, mappings, bounds; structured errors.
3. **getCapabilities** — honest signals, ops, joins, native modes, limits.
4. **compile** — allowlist fields/datasets; bind values (no string concat of user input).
5. **execute** — honor abort/timeouts; classify failures with stable `AdapterError` codes.
6. **normalize** — validate every result frame against the core contract.
7. **secrets** — redact from errors, logs, explain, and metadata.
8. **tests** — compiler, execution, security (injection), response variants.

## Skeleton

```ts
import type {
  AdapterValidationResult,
  CompileContext,
  DatasourceAdapter,
  DatasourceCapabilities,
  ExecutionContext,
} from "@openplait/adapter-sdk";
import type { QueryResult, SemanticQuery } from "@openplait/core";

export class ExampleAdapter
  implements DatasourceAdapter<ExampleConfig, ExampleCompiled> {
  readonly manifest = exampleManifest;

  validateConfig(config: ExampleConfig): AdapterValidationResult<ExampleConfig> {
    return config.url
      ? { valid: true, value: config }
      : { valid: false, errors: [{ path: "/url", message: "URL is required." }] };
  }

  async getCapabilities(): Promise<DatasourceCapabilities> {
    return capabilities;
  }

  async compile(query: SemanticQuery, context: CompileContext) {
    return compileBoundedRequest(query, context);
  }

  async execute(
    compiled: ExampleCompiled,
    context: ExecutionContext,
  ): Promise<QueryResult> {
    const response = await requestBackend(compiled, context.abortSignal);
    return normalizeResponse(response);
  }
}
```

## Package layout (suggested)

```
typescript/packages/adapter-<name>/
  src/index.ts          # public exports
  src/adapter.ts        # DatasourceAdapter impl
  src/capabilities.ts
  src/compile.ts
  src/normalize.ts
  src/errors.ts
  tests/
  package.json
```

Register the adapter with the host via `DatasourceRegistry` (see skill
`integrate-openplait`). Document kind name and config shape for consumers.

## Docs

- `docs/content/adapters/custom.mdx`
- `docs/content/reference/adapter-sdk.mdx`
- Reference adapters under `typescript/packages/adapter-*`
