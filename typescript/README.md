# OpenPlait (TypeScript)

TypeScript / Node reference implementation of
[OpenPlait](https://github.com/openlit/openplait) — portable query IR, adapters,
and runtime under the `@openplait/*` npm scope.

This directory is the npm workspace root (mirrors [`../python`](../python) for
the Python port).

## Layout

```text
typescript/
  package.json          # workspace root (private)
  tsconfig.base.json
  packages/
    core/
    adapter-sdk/
    adapter-clickhouse/
    adapter-tempo/
    adapter-loki/
    adapter-prometheus/
    adapter-jaeger/
    runtime/
    perses/
```

## Requirements

- Node.js ≥ 20.19
- npm ≥ 10

## Develop

```bash
cd typescript
npm install
npm run check
npm run build
```

## Install published packages

```bash
npm install @openplait/core @openplait/adapter-sdk \
  @openplait/runtime @openplait/adapter-clickhouse
```

## Release

npm publishes follow OpenLIT’s TypeScript SDK workflow: push a `ts-*.*.*` tag
that matches `packages/core` version. See [`../PUBLISHING.md`](../PUBLISHING.md).

## Docs

- [Getting started](../docs/content/getting-started.mdx)
- [TypeScript guide](../docs/content/guides/typescript.mdx)
- [Python guide](../docs/content/guides/python.mdx)

## License

Apache-2.0
