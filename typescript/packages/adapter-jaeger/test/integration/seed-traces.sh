#!/usr/bin/env bash
# Seed a small OTLP/HTTP trace into local Jaeger (all-in-one OTLP on :4318).
set -euo pipefail

OTLP_HTTP="${OTLP_HTTP:-http://localhost:4318}"
SERVICE_NAME="${SERVICE_NAME:-openlit-demo}"
NOW_NS="$(($(date +%s) * 1000000000))"
START_NS=$((NOW_NS - 250000000))
END_NS=$NOW_NS
# 16-byte trace / 8-byte span IDs as lowercase hex
TRACE_ID="$(openssl rand -hex 16)"
ROOT_SPAN_ID="$(openssl rand -hex 8)"
CHILD_SPAN_ID="$(openssl rand -hex 8)"

payload=$(cat <<EOF
{
  "resourceSpans": [{
    "resource": {
      "attributes": [
        { "key": "service.name", "value": { "stringValue": "${SERVICE_NAME}" } },
        { "key": "telemetry.sdk.name", "value": { "stringValue": "openlit" } },
        { "key": "deployment.environment", "value": { "stringValue": "local" } }
      ]
    },
    "scopeSpans": [{
      "scope": { "name": "openplait.jaeger.seed", "version": "0.1.0" },
      "spans": [
        {
          "traceId": "${TRACE_ID}",
          "spanId": "${ROOT_SPAN_ID}",
          "name": "checkout",
          "kind": 1,
          "startTimeUnixNano": "${START_NS}",
          "endTimeUnixNano": "${END_NS}",
          "attributes": [
            { "key": "gen_ai.system", "value": { "stringValue": "openai" } },
            { "key": "gen_ai.request.model", "value": { "stringValue": "gpt-4o-mini" } },
            { "key": "gen_ai.operation.name", "value": { "stringValue": "chat" } }
          ],
          "status": { "code": 1 }
        },
        {
          "traceId": "${TRACE_ID}",
          "spanId": "${CHILD_SPAN_ID}",
          "parentSpanId": "${ROOT_SPAN_ID}",
          "name": "gen_ai.chat",
          "kind": 3,
          "startTimeUnixNano": "${START_NS}",
          "endTimeUnixNano": "${END_NS}",
          "attributes": [
            { "key": "gen_ai.system", "value": { "stringValue": "openai" } },
            { "key": "gen_ai.request.model", "value": { "stringValue": "gpt-4o-mini" } },
            { "key": "gen_ai.usage.input_tokens", "value": { "intValue": "42" } },
            { "key": "gen_ai.usage.output_tokens", "value": { "intValue": "17" } }
          ],
          "status": { "code": 1 }
        }
      ]
    }]
  }]
}
EOF
)

echo "Seeding trace ${TRACE_ID} for service ${SERVICE_NAME} → ${OTLP_HTTP}/v1/traces"
curl -sS -X POST "${OTLP_HTTP}/v1/traces" \
  -H "Content-Type: application/json" \
  -d "${payload}" \
  -o /tmp/jaeger-seed-response.txt \
  -w "HTTP %{http_code}\n"
cat /tmp/jaeger-seed-response.txt
echo
echo "Verify:"
echo "  curl -s 'http://localhost:16686/api/services' | jq"
echo "  open http://localhost:16686/trace/${TRACE_ID}"
