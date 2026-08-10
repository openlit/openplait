# OpenPlait documentation

Dashboard-style docs site (Next.js App Router + Tailwind) for
[openlit/openplait](https://github.com/openlit/openplait).

```bash
git clone git@github.com:openlit/openplait.git
cd openplait
npm install --prefix docs
npm run docs:dev    # http://localhost:3002
npm run docs:build  # writes docs/out (static export)
```

- **Repository:** `git@github.com:openlit/openplait.git`
- **Browse:** https://github.com/openlit/openplait
- Content: `content/**/*.mdx`
- Navigation: `lib/nav.ts`

Package READMEs under `typescript/packages/*` and `python/` stay concise for
npm/PyPI; this site covers concepts, guides (TypeScript / Python tabs), examples,
OpenLIT integration, and brand.
