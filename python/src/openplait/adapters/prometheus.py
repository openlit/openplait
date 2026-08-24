"""Prometheus / Mimir adapter — native PromQL query_range."""

from __future__ import annotations

import time
from dataclasses import dataclass
from datetime import datetime
from typing import Any, Dict, List, Optional

from openplait.adapter_sdk.errors import AdapterError
from openplait.adapter_sdk.http import (
    HttpDatasourceConfig,
    coerce_config,
    datasource_url,
    normalize_base_url,
    request_json,
    validate_auth_combo,
    validate_http_url,
)
from openplait.adapter_sdk.types import (
    AdapterManifest,
    AdapterValidationIssue,
    AdapterValidationResult,
    DatasourceCapabilities,
    JoinCapabilities,
)
from openplait.adapters._frames import frame_from_rows, query_result
from openplait.core.models import Query, QueryResult
from openplait.version import OPENPLAIT_SPEC_VERSION


@dataclass
class PrometheusConfig(HttpDatasourceConfig):
    default_step: str = "30s"


def _to_epoch_seconds(value: Any) -> float:
    if isinstance(value, (int, float)):
        number = float(value)
        return number / 1000.0 if number > 1e12 else number
    text = str(value)
    try:
        return datetime.fromisoformat(text.replace("Z", "+00:00")).timestamp()
    except ValueError as exc:
        raise AdapterError(
            "TIME_RANGE_REQUIRED",
            f"Invalid time value: {value}",
        ) from exc


class PrometheusAdapter:
    """Python port of @openplait/adapter-prometheus (native PromQL first)."""

    def __init__(self, config: PrometheusConfig | Dict[str, Any]) -> None:
        validation = self.validate_config(config)
        if not validation.valid:
            raise AdapterError(
                "CONFIG_INVALID",
                "; ".join(issue.message for issue in validation.errors),
            )
        assert validation.value is not None
        self._config = validation.value
        self._config.url = normalize_base_url(self._config.url)

    @property
    def manifest(self) -> AdapterManifest:
        return AdapterManifest(
            name="prometheus",
            display_name="Prometheus",
            version=OPENPLAIT_SPEC_VERSION,
            query_languages=["openplait-semantic", "promql"],
            signals=["metrics"],
        )

    def validate_config(
        self, config: Any
    ) -> AdapterValidationResult[PrometheusConfig]:
        try:
            parsed = coerce_config(config, PrometheusConfig)
        except TypeError as exc:
            return AdapterValidationResult(
                valid=False,
                errors=[
                    AdapterValidationIssue(
                        code="CONFIG_INVALID", path="/", message=str(exc)
                    )
                ],
            )
        errors = validate_http_url(parsed.url, label="Prometheus URL")
        errors.extend(validate_auth_combo(parsed))
        if errors:
            return AdapterValidationResult(valid=False, errors=errors)
        return AdapterValidationResult(valid=True, value=parsed, errors=[])

    async def get_capabilities(self, config: Any = None) -> DatasourceCapabilities:
        del config
        return DatasourceCapabilities(
            signals=["metrics"],
            operations=[
                "select",
                "filter",
                "aggregate",
                "group",
                "limit",
                "rate",
                "timeBucket",
            ],
            joins=JoinCapabilities(local=False, cross_datasource=False),
            native_query_languages=["promql"],
            explain=True,
            schema_discovery=True,
        )

    async def execute(
        self,
        query: Query,
        *,
        config: Any = None,
        timeout_ms: Optional[int] = None,
    ) -> QueryResult:
        del config
        if query.spec.mode != "native":
            raise AdapterError(
                "NOT_IMPLEMENTED",
                "Python Prometheus semantic compile is not implemented yet; "
                "use mode=native with language=promql.",
            )
        if not self._config.allow_native_queries:
            raise AdapterError(
                "NATIVE_QUERY_REJECTED",
                "Native PromQL is disabled for this datasource.",
            )
        if query.spec.native.language.lower() != "promql":
            raise AdapterError(
                "NATIVE_QUERY_REJECTED",
                "Prometheus native queries must use language=promql.",
            )
        statement = query.spec.native.statement.strip()
        if not statement or "\0" in statement:
            raise AdapterError(
                "NATIVE_QUERY_REJECTED",
                "Native PromQL statement is empty or invalid.",
            )

        extension = (query.spec.extensions or {}).get("io.openplait.prometheus") or {}
        time_range = extension.get("timeRange") or {}
        if not time_range.get("from") or not time_range.get("to"):
            raise AdapterError(
                "TIME_RANGE_REQUIRED",
                "Native PromQL requires io.openplait.prometheus.timeRange.",
            )

        started = time.perf_counter()
        url = datasource_url(
            self._config.url,
            "api/v1/query_range",
            {
                "query": statement,
                "start": _to_epoch_seconds(time_range["from"]),
                "end": _to_epoch_seconds(time_range["to"]),
                "step": extension.get("step") or self._config.default_step,
            },
        )
        payload = await request_json(
            url,
            config=self._config,
            timeout_ms=timeout_ms,
            datasource_name="Prometheus",
        )
        rows: List[Dict[str, Any]] = []
        data = (payload or {}).get("data") or {}
        result_type = data.get("resultType")
        results = data.get("result") or []
        if result_type == "matrix":
            for series in results:
                labels = series.get("metric") or {}
                for point in series.get("values") or []:
                    if not isinstance(point, (list, tuple)) or len(point) < 2:
                        continue
                    rows.append(
                        {
                            "timestamp": point[0],
                            "value": float(point[1]),
                            "metric.name": labels.get("__name__"),
                            "labels": labels,
                        }
                    )
        elif result_type == "vector":
            for series in results:
                labels = series.get("metric") or {}
                value = series.get("value") or []
                if len(value) >= 2:
                    rows.append(
                        {
                            "timestamp": value[0],
                            "value": float(value[1]),
                            "metric.name": labels.get("__name__"),
                            "labels": labels,
                        }
                    )

        elapsed = (time.perf_counter() - started) * 1000
        return query_result(
            [
                frame_from_rows(
                    query.metadata.name,
                    rows,
                    field_types={
                        "timestamp": "time",
                        "value": "number",
                        "metric.name": "string",
                        "labels": "json",
                    },
                )
            ],
            datasource="prometheus",
            execution_time_ms=elapsed,
        )
