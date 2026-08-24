"""Shipped OpenPlait datasource adapters."""

from openplait.adapters.clickhouse import ClickHouseAdapter, ClickHouseConfig
from openplait.adapters.jaeger import JaegerAdapter, JaegerConfig
from openplait.adapters.loki import LokiAdapter, LokiConfig
from openplait.adapters.prometheus import PrometheusAdapter, PrometheusConfig
from openplait.adapters.tempo import TempoAdapter, TempoConfig

__all__ = [
    "ClickHouseAdapter",
    "ClickHouseConfig",
    "JaegerAdapter",
    "JaegerConfig",
    "LokiAdapter",
    "LokiConfig",
    "PrometheusAdapter",
    "PrometheusConfig",
    "TempoAdapter",
    "TempoConfig",
]
