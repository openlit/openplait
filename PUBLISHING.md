# Publishing OpenPlait

**Repository:** [openlit/openplait](https://github.com/openlit/openplait)  
**Clone:** `git clone git@github.com:openlit/openplait.git`

OpenPlait ships two language tracks:

| Track | Sources | Packages | Tag | Workflow | Auth |
| --- | --- | --- | --- | --- | --- |
| TypeScript | [`typescript/`](./typescript) | `@openplait/*` on npm | `ts-*.*.*` | [`.github/workflows/npm-release.yml`](./.github/workflows/npm-release.yml) | [Trusted publishing (OIDC)](https://docs.npmjs.com/trusted-publishers) — no `NPM_TOKEN` |
| Python | [`python/`](./python) | `openplait` on PyPI | `py-*.*.*` | [`.github/workflows/pypi-release.yml`](./.github/workflows/pypi-release.yml) | `PYPI_API_TOKEN` |

Current TypeScript line: **`1.0.0`** (npm dist-tag `latest`).  
Current Python line: **`1.0.0`**.

The private workspace root is `typescript/` (package name `openplait`, not published).

---

## npm (`@openplait/*`)

### Publish order

1. `@openplait/core`
2. `@openplait/adapter-sdk`
3. `@openplait/adapter-clickhouse`
4. `@openplait/adapter-tempo`
5. `@openplait/adapter-loki`
6. `@openplait/adapter-prometheus`
7. `@openplait/adapter-jaeger`
8. `@openplait/runtime`
9. `@openplait/perses`

### Package checklist

Each publishable package under `typescript/packages/<name>` includes:

- `"license": "Apache-2.0"` + `LICENSE`
- `"publishConfig": { "access": "public", "registry": "https://registry.npmjs.org/" }`
- `"files"` limited to build output + `README.md` + `LICENSE`
- `"prepack": "npm run build"`
- `"engines": { "node": ">=20.19" }`
- `repository.directory` → `typescript/packages/<name>`

### One-time npm trusted publisher setup

Follow [Trusted publishing](https://docs.npmjs.com/trusted-publishers). Requires
**Node ≥ 22.14** and **npm ≥ 11.5.1** in CI (the workflow uses Node 24).

1. Create / claim the **`@openplait`** org on [npmjs.com](https://www.npmjs.com/).
2. For **each** `@openplait/*` package → **Settings → Trusted Publisher → GitHub Actions**:
   - **Organization or user:** `openlit`
   - **Repository:** `openplait`
   - **Workflow filename:** `npm-release.yml` (filename only, must match exactly)
   - **Allowed actions:** `npm publish`
3. Do **not** set `NODE_AUTH_TOKEN` / `NPM_TOKEN` on the publish job — OIDC replaces it.
   Provenance is generated automatically.
4. Optional hardening after OIDC works: package **Publishing access** →
   “Require two-factor authentication and disallow tokens”.

If a package does not exist yet, publish it once manually (with OTP) to create it,
then add the trusted publisher and switch fully to CI.

### Local dry run

```sh
cd typescript
npm install
npm run publish:check

npm pack -w @openplait/core
tar -tzf openplait-core-*.tgz | head
```

### Manual publish (bootstrap / emergency)

```sh
cd typescript
npm publish -w @openplait/core --access public --tag latest --otp=<code>
# …repeat in publish order, or rely on CI after trusted publishers are configured
```

### CI publish (trusted publishing)

1. Bump **all** workspace package versions together (and internal `dependencies`).
2. Commit on the release branch.
3. Tag must match `typescript/packages/core` `package.json` `version`:

```sh
cd typescript
VERSION=$(node -p "require('./packages/core/package.json').version")
git tag "ts-${VERSION}"
git push origin "ts-${VERSION}"
```

4. [`.github/workflows/npm-release.yml`](./.github/workflows/npm-release.yml) runs with
   `working-directory: typescript` on tags `ts-*.*.*` (and `workflow_dispatch`):
   - validates tag version ↔ `packages/core/package.json`
   - `npm ci` → `npm run check` → `npm run build`
   - `npm publish -w <pkg> --access public --tag <dist-tag>` via OIDC

Default dist-tag for CI is **`latest`** on stable tags (`ts-1.0.0`).
Pre-release versions (`alpha` / `beta` / `rc` in the tag) still publish to
`alpha`. Override with `workflow_dispatch` input when needed.

### Consuming from OpenLIT

```json
{
  "dependencies": {
    "@openplait/core": "1.0.0",
    "@openplait/adapter-sdk": "1.0.0",
    "@openplait/adapter-clickhouse": "1.0.0",
    "@openplait/adapter-tempo": "1.0.0",
    "@openplait/adapter-loki": "1.0.0",
    "@openplait/adapter-prometheus": "1.0.0",
    "@openplait/adapter-jaeger": "1.0.0",
    "@openplait/runtime": "1.0.0"
  }
}
```

---

## PyPI (`openplait`)

Python sources live in [`python/`](./python). Packaging uses **Poetry**, same as
OpenLIT’s `sdk/python`.

### One-time PyPI setup

1. Create the `openplait` project on [pypi.org](https://pypi.org/).
2. Create an API token and store it as GitHub Actions secret **`PYPI_API_TOKEN`**.

### Local dry run

```sh
cd python
poetry install
poetry run pytest
rm -rf dist/
poetry build
pip install twine && twine check dist/*
```

### CI publish (OpenLIT-style)

1. Bump `[tool.poetry].version` in `python/pyproject.toml` (PEP 440, e.g. `1.0.0`).
2. Tag and push:

```sh
cd python
VERSION=$(poetry version -s)
git tag "py-${VERSION}"
git push origin "py-${VERSION}"
```

3. [`.github/workflows/pypi-release.yml`](./.github/workflows/pypi-release.yml) runs on
   `push` tags `py-*.*.*` (and `workflow_dispatch`).

---

## Versioning policy

- Keep TypeScript workspace versions **identical** across `@openplait/*`.
- Align Python `1.0.0` with TS `1.0.0` (PEP 440 vs semver).
- Patch: bugfixes only. Minor: additive. Breaking portable IR → new `apiVersion`.
- Do not publish the private `typescript/` workspace root package.
