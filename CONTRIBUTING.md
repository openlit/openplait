# Contributing to OpenPlait

OpenPlait is specification-first. Changes should keep portable behavior small,
typed, capability-aware, and independent of any one datasource.

## Proposing changes

Bug fixes and clarifications can be submitted directly. Changes to resource
meaning, portable query operations, result contracts, or compatibility rules
should begin as an RFC in `rfcs/` describing motivation, semantics, security,
compatibility, and migration impact.

Breaking changes require a new API version and a deterministic migration path.
Unknown extension fields should be preserved whenever practical.

## Development workflow

Clone the repository:

```sh
git clone git@github.com:openlit/openplait.git
cd openplait
```

### TypeScript (reference implementation)

Workspace root: [`typescript/`](./typescript).

```sh
cd typescript
npm install
npm run check
npm run build
```

### Python

Package root: [`python/`](./python).

```sh
cd python
poetry install
poetry run pytest
```

Keep Python models and `OPENPLAIT_API_VERSION` aligned with `@openplait/core`
under `typescript/packages/core`. When you change JSON Schemas or Query IR,
update TypeScript types **and** the Python Pydantic models / tests together.

Pull requests should include tests and examples for observable behavior. Schema
changes must update TypeScript types, JSON Schemas, validation tests, and at
least one example together.

## Releases

Follow [`PUBLISHING.md`](./PUBLISHING.md). npm tags use `ts-*.*.*` (from
`typescript/`) and PyPI tags use `py-*.*.*` (from `python/`), matching OpenLIT’s
`ts-*` / `py-*` release pattern.

## Commit and review expectations

Keep commits focused and explain user-visible behavior. At least one maintainer
review is required. Security-sensitive changes, API-version changes, and new
portable operations require two maintainer approvals.

Participation is governed by [`CODE_OF_CONDUCT.md`](./CODE_OF_CONDUCT.md).
