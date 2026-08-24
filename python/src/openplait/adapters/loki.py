"""Grafana Loki adapter — native LogQL query_range."""

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
class LokiConfig(HttpDatasourceConfig):
    pass


def _to_epoch_ns(value: Any) -> str:
    if isinstance(value, (int, float)):
        ms = float(value)
        if ms < 1e12:
            ms *= 1000.0
        return str(int(ms * 1_000_000))
    text = str(value)
    try:
        dt = datetime.fromisoformat(text.replace("Z", "+00:00"))
        return str(int(dt.timestamp() * 1_000_000_000))
    except ValueError as exc:
        raise AdapterError(
            "TIME_RANGE_REQUIRED",
            f"Invalid time value: {value}",
        ) from exc


class LokiAdapter:
    """Python port of @openplait/adapter-loki (native LogQL first)."""

    def __init__(self, config: LokiConfig | Dict[str, Any]) -> None:
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
            name="loki",
            display_name="Grafana Loki",
            version=OPENPLAIT_SPEC_VERSION,
            query_languages=["openplait-semantic", "logql"],
            signals=["logs"],
        )

    def validate_config(self, config: Any) -> AdapterValidationResult[LokiConfig]:
        try:
            parsed = coerce_config(config, LokiConfig)
        except TypeError as exc:
            return AdapterValidationResult(
                valid=False,
                errors=[
                    AdapterValidationIssue(
                        code="CONFIG_INVALID", path="/", message=str(exc)
                    )
                ],
            )
        errors = validate_http_url(parsed.url, label="Loki URL")
        errors.extend(validate_auth_combo(parsed))
        if errors:
            return AdapterValidationResult(valid=False, errors=errors)
        return AdapterValidationResult(valid=True, value=parsed, errors=[])

    async def get_capabilities(self, config: Any = None) -> DatasourceCapabilities:
        del config
        return DatasourceCapabilities(
            signals=["logs"],
            operations=["select", "filter", "order", "limit"],
            joins=JoinCapabilities(local=False, cross_datasource=False),
            native_query_languages=["logql"],
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
                "Python Loki semantic compile is not implemented yet; "
                "use mode=native with language=logql.",
            )
        if not self._config.allow_native_queries:
            raise AdapterError(
                "NATIVE_QUERY_REJECTED",
                "Native LogQL is disabled for this datasource.",
            )
        if query.spec.native.language.lower() != "logql":
            raise AdapterError(
                "NATIVE_QUERY_REJECTED",
                "Loki native queries must use language=logql.",
            )
        statement = query.spec.native.statement.strip()
        if not statement or "\0" in statement:
            raise AdapterError(
                "NATIVE_QUERY_REJECTED",
                "Native LogQL statement is empty or invalid.",
            )

        extension = (query.spec.extensions or {}).get("io.openplait.loki") or {}
        time_range = extension.get("timeRange") or {}
        if not time_range.get("from") or not time_range.get("to"):
            raise AdapterError(
                "TIME_RANGE_REQUIRED",
                "Native LogQL requires io.openplait.loki.timeRange.",
            )

        maximum = self._config.max_result_rows or 5_000
        limit = int(extension.get("limit") or min(1_000, maximum))
        if limit < 1 or limit > maximum:
            raise AdapterError(
                "QUERY_LIMIT_EXCEEDED",
                f"Loki limit exceeds {maximum}.",
            )

        started = time.perf_counter()
        url = datasource_url(
            self._config.url,
            "loki/api/v1/query_range",
            {
                "query": statement,
                "start": _to_epoch_ns(time_range["from"]),
                "end": _to_epoch_ns(time_range["to"]),
                "limit": limit,
                "direction": extension.get("direction") or "backward",
            },
        )
        payload = await request_json(
            url,
            config=self._config,
            timeout_ms=timeout_ms,
            datasource_name="Loki",
        )
        rows: List[Dict[str, Any]] = []
        results = ((payload or {}).get("data") or {}).get("result") or []
        for stream in results:
            labels = stream.get("stream") or stream.get("metric") or {}
            for entry in stream.get("values") or []:
                if not isinstance(entry, (list, tuple)) or len(entry) < 2:
                    continue
                rows.append(
                    {
                        "timestamp": entry[0],
                        "body": entry[1],
                        "labels": labels,
                        "service.name": labels.get("service_name")
                        or labels.get("service"),
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
                        "body": "string",
                        "labels": "json",
                        "service.name": "string",
                    },
                )
            ],
            datasource="loki",
            execution_time_ms=elapsed,
        )
