# Local Loki and Prometheus integration stack

```sh
docker compose up -d
curl -fsS http://localhost:3100/ready
curl -fsS http://localhost:9090/-/ready
```

Prometheus scrapes itself and supplies an `up{job="prometheus"}` series. Push a
log to Loki, then run the real-adapter checks from the repository root:

```sh
OPENPLAIT_RUN_DOCKER_INTEGRATION=1 npm test --workspace @openplait/runtime -- \
  --run test/integration/loki-prometheus.integration.test.ts
```

Stop the containers without deleting their volumes using `docker compose stop`.
Use `docker compose down -v` only when the local test data should be removed.
