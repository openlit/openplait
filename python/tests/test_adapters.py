"""Adapter config + native execute unit tests."""

from __future__ import annotations

from typing import Any, Dict
from unittest.mock import AsyncMock, patch

import pytest

from openplait import OPENPLAIT_API_VERSION
from openplait.adapter_sdk.errors import AdapterError
from openplait.adapters import (
    ClickHouseAdapter,
    ClickHouseConfig,
    JaegerAdapter,
    JaegerConfig,
    LokiAdapter,
    LokiConfig,
    PrometheusAdapter,
    PrometheusConfig,
    TempoAdapter,
    TempoConfig,
)
from openplait.core import parse_query


def test_all_adapters_reject_bad_url():
    cases = [
        (ClickHouseAdapter, ClickHouseConfig, "ftp://bad"),
        (LokiAdapter, LokiConfig, "ftp://bad"),
        (PrometheusAdapter, PrometheusConfig, "ftp://bad"),
        (TempoAdapter, TempoConfig, "ftp://bad"),
        (JaegerAdapter, JaegerConfig, "ftp://bad"),
    ]
    for adapter_cls, config_cls, url in cases:
        with pytest.raises(AdapterError) as exc:
            adapter_cls(config_cls(url=url))
        assert exc.value.code == "CONFIG_INVALID"


def test_capabilities_signals():
    assert "traces" in ClickHouseAdapter(ClickHouseConfig(url="http://localhost:8123")).manifest.signals
    assert LokiAdapter(LokiConfig(url="http://localhost:3100")).manifest.signals == ["logs"]
    assert PrometheusAdapter(PrometheusConfig(url="http://localhost:9090")).manifest.signals == ["metrics"]
    assert TempoAdapter(TempoConfig(url="http://localhost:3200")).manifest.signals == ["traces"]
    assert JaegerAdapter(JaegerConfig(url="http://localhost:16686")).manifest.signals == ["traces"]


@pytest.mark.asyncio
async def test_loki_native_execute_normalizes_streams():
    adapter = LokiAdapter(LokiConfig(url="http://localhost:3100"))
    query = parse_query(
        {
            "apiVersion": OPENPLAIT_API_VERSION,
            "kind": "Query",
            "metadata": {"name": "errors"},
            "spec": {
                "mode": "native",
                "datasource": {"kind": "LokiDatasource", "name": "logs"},
                "native": {
                    "language": "logql",
                    "statement": '{service_name="checkout"}',
                },
                "extensions": {
                    "io.openplait.loki": {
                        "timeRange": {
                            "from": "2026-08-05T00:00:00Z",
                            "to": "2026-08-05T01:00:00Z",
                        },
                        "limit": 10,
                    }
                },
            },
        }
    )
    payload: Dict[str, Any] = {
        "status": "success",
        "data": {
            "resultType": "streams",
            "result": [
                {
                    "stream": {"service_name": "checkout"},
                    "values": [["1700000000000000000", "boom"]],
                }
            ],
        },
    }
    with patch(
        "openplait.adapters.loki.request_json",
        new=AsyncMock(return_value=payload),
    ):
        result = await adapter.execute(query)
    assert result.frames[0].length == 1
    body = next(f for f in result.frames[0].fields if f.name == "body")
    assert body.values == ["boom"]


@pytest.mark.asyncio
async def test_prometheus_native_execute_matrix():
    adapter = PrometheusAdapter(PrometheusConfig(url="http://localhost:9090"))
    query = parse_query(
        {
            "apiVersion": OPENPLAIT_API_VERSION,
            "kind": "Query",
            "metadata": {"name": "rate"},
            "spec": {
                "mode": "native",
                "datasource": {"kind": "PrometheusDatasource", "name": "metrics"},
                "native": {
                    "language": "promql",
                    "statement": "up",
                },
                "extensions": {
                    "io.openplait.prometheus": {
                        "timeRange": {
                            "from": "2026-08-05T00:00:00Z",
                            "to": "2026-08-05T01:00:00Z",
                        },
                        "step": "30s",
                    }
                },
            },
        }
    )
    payload = {
        "status": "success",
        "data": {
            "resultType": "matrix",
            "result": [
                {
                    "metric": {"__name__": "up", "job": "api"},
                    "values": [[1700000000, "1"]],
                }
            ],
        },
    }
    with patch(
        "openplait.adapters.prometheus.request_json",
        new=AsyncMock(return_value=payload),
    ):
        result = await adapter.execute(query)
    assert result.frames[0].length == 1
    value = next(f for f in result.frames[0].fields if f.name == "value")
    assert value.values == [1.0]


@pytest.mark.asyncio
async def test_tempo_native_execute_search():
    adapter = TempoAdapter(TempoConfig(url="http://localhost:3200"))
    query = parse_query(
        {
            "apiVersion": OPENPLAIT_API_VERSION,
            "kind": "Query",
            "metadata": {"name": "traces"},
            "spec": {
                "mode": "native",
                "datasource": {"kind": "TempoDatasource", "name": "tempo"},
                "native": {"language": "traceql", "statement": '{ resource.service.name = "checkout" }'},
                "extensions": {
                    "io.openplait.tempo": {
                        "timeRange": {
                            "from": "2026-08-05T00:00:00Z",
                            "to": "2026-08-05T01:00:00Z",
                        }
                    }
                },
            },
        }
    )
    payload = {
        "traces": [
            {
                "traceID": "abc",
                "rootServiceName": "checkout",
                "rootTraceName": "POST /pay",
                "startTimeUnixNano": "1",
                "durationMs": 12,
            }
        ]
    }
    with patch(
        "openplait.adapters.tempo.request_json",
        new=AsyncMock(return_value=payload),
    ):
        result = await adapter.execute(query)
    assert result.frames[0].length == 1


@pytest.mark.asyncio
async def test_jaeger_semantic_requires_service():
    adapter = JaegerAdapter(JaegerConfig(url="http://localhost:16686"))
    query = parse_query(
        {
            "apiVersion": OPENPLAIT_API_VERSION,
            "kind": "Query",
            "metadata": {"name": "spans"},
            "spec": {
                "mode": "semantic",
                "datasource": {"kind": "JaegerDatasource", "name": "jaeger"},
                "input": {"signal": "traces", "entity": "jaeger.traces"},
                "select": [{"field": "trace.id"}],
                "where": {"field": "span.name", "operator": "equals", "value": "x"},
                "timeRange": {
                    "field": "start.time",
                    "from": "2026-08-05T00:00:00Z",
                    "to": "2026-08-05T01:00:00Z",
                },
            },
        }
    )
    with pytest.raises(AdapterError) as exc:
        await adapter.execute(query)
    assert exc.value.code == "QUERY_VALIDATION_FAILED"


@pytest.mark.asyncio
async def test_jaeger_semantic_execute():
    adapter = JaegerAdapter(JaegerConfig(url="http://localhost:16686"))
    query = parse_query(
        {
            "apiVersion": OPENPLAIT_API_VERSION,
            "kind": "Query",
            "metadata": {"name": "spans"},
            "spec": {
                "mode": "semantic",
                "datasource": {"kind": "JaegerDatasource", "name": "jaeger"},
                "input": {"signal": "traces", "entity": "jaeger.traces"},
                "select": [{"field": "trace.id"}],
                "where": {
                    "field": "service.name",
                    "operator": "equals",
                    "value": "checkout",
                },
                "timeRange": {
                    "field": "start.time",
                    "from": "2026-08-05T00:00:00Z",
                    "to": "2026-08-05T01:00:00Z",
                },
                "limit": 10,
            },
        }
    )
    payload = {
        "data": [
            {
                "traceID": "t1",
                "spans": [
                    {
                        "spanID": "s1",
                        "operationName": "POST /pay",
                        "processID": "p1",
                        "startTime": 1,
                        "duration": 100,
                    }
                ],
                "processes": {"p1": {"serviceName": "checkout"}},
            }
        ]
    }
    with patch(
        "openplait.adapters.jaeger.request_json",
        new=AsyncMock(return_value=payload),
    ):
        result = await adapter.execute(query)
    assert result.frames[0].length == 1
