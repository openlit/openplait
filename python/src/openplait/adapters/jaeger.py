"""Jaeger Query HTTP adapter — service-scoped trace search."""

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
class JaegerConfig(HttpDatasourceConfig):
    services: Optional[List[str]] = None
    per_service_limit: int = 100


def _to_epoch_us(value: Any) -> int:
    if isinstance(value, (int, float)):
        number = float(value)
        if number > 1e15:  # ns
            return int(number / 1_000)
        if number > 1e12:  # ms
            return int(number * 1_000)
        return int(number * 1_000_000)
    text = str(value)
    try:
        return int(
            datetime.fromisoformat(text.replace("Z", "+00:00")).timestamp() * 1_000_000
        )
    except ValueError as exc:
        raise AdapterError(
            "TIME_RANGE_REQUIRED",
            f"Invalid time value: {value}",
        ) from exc


class JaegerAdapter:
    """Python port of @openplait/adapter-jaeger (search API first)."""

    def __init__(self, config: JaegerConfig | Dict[str, Any]) -> None:
        validation = self.validate_config(config)
        if not validation.valid:
            raise AdapterError(
                "CONFIG_INVALID",
                "; ".join(issue.message for issue in validation.errors),
            )
        assert validation.value is not None
        self._config = validation.value
        self._config.url = normalize_base_url(self._config.url)
        self._resolved_url = self._config.url

    @property
    def resolved_url(self) -> str:
        return self._resolved_url

    @property
    def manifest(self) -> AdapterManifest:
        return AdapterManifest(
            name="jaeger",
            display_name="Jaeger",
            version=OPENPLAIT_SPEC_VERSION,
            query_languages=["openplait-semantic"],
            signals=["traces"],
        )

    def validate_config(self, config: Any) -> AdapterValidationResult[JaegerConfig]:
        try:
            parsed = coerce_config(config, JaegerConfig)
        except TypeError as exc:
            return AdapterValidationResult(
                valid=False,
                errors=[
                    AdapterValidationIssue(
                        code="CONFIG_INVALID", path="/", message=str(exc)
                    )
                ],
            )
        errors = validate_http_url(parsed.url, label="Jaeger URL")
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
            native_query_languages=[],
            explain=True,
            schema_discovery=True,
        )

    async def list_services(self, *, timeout_ms: Optional[int] = None) -> List[str]:
        for base in (self._config.url, f"{self._config.url}/jaeger"):
            try:
                payload = await request_json(
                    datasource_url(base, "api/services"),
                    config=self._config,
                    timeout_ms=timeout_ms,
                    datasource_name="Jaeger",
                )
                self._resolved_url = base
                data = (payload or {}).get("data") or []
                return [item for item in data if isinstance(item, str)]
            except AdapterError:
                continue
        raise AdapterError(
            "UPSTREAM_ERROR",
            "Jaeger /api/services is unavailable at the configured URL.",
        )

    async def execute(
        self,
        query: Query,
        *,
        config: Any = None,
        timeout_ms: Optional[int] = None,
    ) -> QueryResult:
        del config
        if query.spec.mode != "semantic":
            raise AdapterError(
                "NATIVE_QUERY_REJECTED",
                "Jaeger has no native query language; use semantic mode.",
            )

        where = query.spec.where or {}
        service = _extract_service_equals(where)
        if not service:
            raise AdapterError(
                "QUERY_VALIDATION_FAILED",
                "Jaeger search requires a service.name equals filter.",
            )

        extension = (query.spec.extensions or {}).get("io.openplait.jaeger") or {}
        time_range = (query.spec.time_range and {
            "from": query.spec.time_range.from_,
            "to": query.spec.time_range.to,
        }) or extension.get("timeRange") or {}
        if not time_range.get("from") or not time_range.get("to"):
            raise AdapterError(
                "TIME_RANGE_REQUIRED",
                "Jaeger search requires a time range.",
            )

        limit = min(
            query.spec.limit or self._config.per_service_limit,
            self._config.max_result_rows or 1_000,
            self._config.per_service_limit,
        )
        started = time.perf_counter()
        base = self._resolved_url
        url = datasource_url(
            base,
            "api/traces",
            {
                "service": service,
                "start": _to_epoch_us(time_range["from"]),
                "end": _to_epoch_us(time_range["to"]),
                "limit": limit,
            },
        )
        try:
            payload = await request_json(
                url,
                config=self._config,
                timeout_ms=timeout_ms,
                datasource_name="Jaeger",
            )
        except AdapterError:
            # Retry with /jaeger prefix once.
            self._resolved_url = f"{self._config.url}/jaeger"
            url = datasource_url(
                self._resolved_url,
                "api/traces",
                {
                    "service": service,
                    "start": _to_epoch_us(time_range["from"]),
                    "end": _to_epoch_us(time_range["to"]),
                    "limit": limit,
                },
            )
            payload = await request_json(
                url,
                config=self._config,
                timeout_ms=timeout_ms,
                datasource_name="Jaeger",
            )

        rows: List[Dict[str, Any]] = []
        for trace in (payload or {}).get("data") or []:
            trace_id = trace.get("traceID")
            for span in trace.get("spans") or []:
                process = (trace.get("processes") or {}).get(span.get("processID")) or {}
                rows.append(
                    {
                        "trace.id": trace_id,
                        "span.id": span.get("spanID"),
                        "span.name": span.get("operationName"),
                        "service.name": process.get("serviceName"),
                        "start.time": span.get("startTime"),
                        "duration.us": span.get("duration"),
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
                        "span.id": "string",
                        "span.name": "string",
                        "service.name": "string",
                        "start.time": "time",
                        "duration.us": "number",
                    },
                )
            ],
            datasource="jaeger",
            execution_time_ms=elapsed,
        )


def _extract_service_equals(where: Dict[str, Any]) -> Optional[str]:
    if where.get("field") == "service.name" and where.get("operator") == "equals":
        value = where.get("value")
        return str(value) if value is not None else None
    for key in ("and", "or"):
        clauses = where.get(key)
        if isinstance(clauses, list):
            for clause in clauses:
                if isinstance(clause, dict):
                    found = _extract_service_equals(clause)
                    if found:
                        return found
    return None
