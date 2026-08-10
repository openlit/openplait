# Tempo integration smoke test

The live smoke test is opt-in and pins Tempo to `2.8.2`, the first release that
supports the experimental `most_recent` search hint used by OpenLIT.

```bash
docker compose -f typescript/packages/adapter-tempo/test/integration/docker-compose.yml up -d
OPENPLAIT_TEMPO_INTEGRATION_URL=http://127.0.0.1:3200 \
  npm test --workspace @openplait/adapter-tempo
docker compose -f typescript/packages/adapter-tempo/test/integration/docker-compose.yml down
```

The default unit suite does not require Docker; the live test is skipped unless
`OPENPLAIT_TEMPO_INTEGRATION_URL` is set.

