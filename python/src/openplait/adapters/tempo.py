"""Grafana Tempo adapter — TraceQL / search via Tempo HTTP API."""

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
class TempoConfig(HttpDatasourceConfig):
    pass


def _to_epoch_seconds(value: Any) -> int:
    if isinstance(value, (int, float)):
        number = float(value)
        return int(number / 1000.0 if number > 1e12 else number)
    text = str(value)
    try:
        return int(datetime.fromisoformat(text.replace("Z", "+00:00")).timestamp())
    except ValueError as exc:
        raise AdapterError(
            "TIME_RANGE_REQUIRED",
            f"Invalid time value: {value}",
        ) from exc


class TempoAdapter:
    """Python port of @openplait/adapter-tempo (native TraceQL / search first)."""

    def __init__(self, config: TempoConfig | Dict[str, Any]) -> None:
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
            name="tempo",
            display_name="Grafana Tempo",
            version=OPENPLAIT_SPEC_VERSION,
            query_languages=["openplait-semantic", "traceql"],
            signals=["traces"],
        )

    def validate_config(self, config: Any) -> AdapterValidationResult[TempoConfig]:
        try:
            parsed = coerce_config(config, TempoConfig)
        except TypeError as exc:
            return AdapterValidationResult(
                valid=False,
                errors=[
                    AdapterValidationIssue(
                        code="CONFIG_INVALID", path="/", message=str(exc)
                    )
                ],
            )
        errors = validate_http_url(parsed.url, label="Tempo URL")
        errors.extend(validate_auth_combo(parsed))
        if errors:
            return AdapterValidationResult(valid=False, errors=errors)
        return AdapterValidationResult(valid=True, value=parsed, errors=[])

    async def get_capabilities(self, config: Any = None) -> DatasourceCapabilities:
        del config
        return DatasourceCapabilities(
            signals=["traces"],
            operations=["select", "filter", "order", "limit"],
            joins=JoinCapabilities(local=False, cross_datasource=False),
            native_query_languages=["traceql"],
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
                "Python Tempo semantic compile is not implemented yet; "
                "use mode=native with language=traceql.",
            )
        if not self._config.allow_native_queries:
            raise AdapterError(
                "NATIVE_QUERY_REJECTED",
                "Native TraceQL is disabled for this datasource.",
            )
        if query.spec.native.language.lower() != "traceql":
            raise AdapterError(
                "NATIVE_QUERY_REJECTED",
                "Tempo native queries must use language=traceql.",
            )
        statement = query.spec.native.statement.strip()
        if not statement or "\0" in statement:
            raise AdapterError(
                "NATIVE_QUERY_REJECTED",
                "Native TraceQL statement is empty or invalid.",
            )

        extension = (query.spec.extensions or {}).get("io.openplait.tempo") or {}
        time_range = extension.get("timeRange") or {}
        if not time_range.get("from") or not time_range.get("to"):
            raise AdapterError(
                "TIME_RANGE_REQUIRED",
                "Native TraceQL requires io.openplait.tempo.timeRange.",
            )

        maximum = self._config.max_result_rows or 1_000
        limit = int(extension.get("limit") or min(20, maximum))
        started = time.perf_counter()
        url = datasource_url(
            self._config.url,
            "api/search",
            {
                "q": statement,
                "start": _to_epoch_seconds(time_range["from"]),
                "end": _to_epoch_seconds(time_range["to"]),
                "limit": limit,
            },
        )
        payload = await request_json(
            url,
            config=self._config,
            timeout_ms=timeout_ms,
            datasource_name="Tempo",
        )
        rows: List[Dict[str, Any]] = []
        for trace in (payload or {}).get("traces") or []:
            rows.append(
                {
                    "trace.id": trace.get("traceID") or trace.get("traceId"),
                    "root.service.name": trace.get("rootServiceName"),
                    "root.span.name": trace.get("rootTraceName"),
                    "start.time": trace.get("startTimeUnixNano"),
                    "duration.ms": (trace.get("durationMs") or 0),
                }
            )

        elapsed = (time.perf_counter() - started) * 1000
        return query_result(
            [
                frame_from_rows(
                    query.metadata.name,
                    rows,
                    field_types={
                        "trace.id": "trace",
                        "root.service.name": "string",
                        "root.span.name": "string",
                        "start.time": "time",
                        "duration.ms": "number",
                    },
                )
            ],
            datasource="tempo",
            execution_time_ms=elapsed,
        )
