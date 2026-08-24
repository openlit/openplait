"""ClickHouse adapter — native SQL execute via HTTP JSONEachRow."""

from __future__ import annotations

import time
from dataclasses import dataclass
from typing import Any, Dict, List, Optional

from openplait.adapter_sdk.errors import AdapterError
from openplait.adapter_sdk.http import (
    HttpDatasourceConfig,
    coerce_config,
    normalize_base_url,
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
class ClickHouseConfig(HttpDatasourceConfig):
    database: Optional[str] = None


class ClickHouseAdapter:
    """Python port of @openplait/adapter-clickhouse (native SQL first)."""

    def __init__(self, config: ClickHouseConfig | Dict[str, Any]) -> None:
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
            name="clickhouse",
            display_name="ClickHouse",
            version=OPENPLAIT_SPEC_VERSION,
            query_languages=["openplait-semantic", "sql"],
            signals=["metrics", "logs", "traces", "tabular"],
        )

    def validate_config(
        self, config: Any
    ) -> AdapterValidationResult[ClickHouseConfig]:
        try:
            parsed = coerce_config(config, ClickHouseConfig)
        except TypeError as exc:
            return AdapterValidationResult(
                valid=False,
                errors=[
                    AdapterValidationIssue(
                        code="CONFIG_INVALID", path="/", message=str(exc)
                    )
                ],
            )
        errors = validate_http_url(parsed.url, label="ClickHouse URL")
        errors.extend(validate_auth_combo(parsed))
        if errors:
            return AdapterValidationResult(valid=False, errors=errors)
        return AdapterValidationResult(valid=True, value=parsed, errors=[])

    async def get_capabilities(self, config: Any = None) -> DatasourceCapabilities:
        del config
        return DatasourceCapabilities(
            signals=["metrics", "logs", "traces", "tabular"],
            operations=[
                "select",
                "filter",
                "aggregate",
                "group",
                "order",
                "limit",
                "timeBucket",
                "rate",
                "percentile",
                "distinctCount",
                "histogram",
                "arithmetic",
            ],
            joins=JoinCapabilities(local=False, cross_datasource=False),
            native_query_languages=["sql"],
            explain=True,
            schema_discovery=True,
            limits={
                **(
                    {"maxResultRows": self._config.max_result_rows}
                    if self._config.max_result_rows
                    else {}
                ),
            },
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
                "Python ClickHouse semantic compile is not implemented yet; "
                "use mode=native with language=sql, or @openplait/adapter-clickhouse.",
            )
        if not self._config.allow_native_queries:
            raise AdapterError(
                "NATIVE_QUERY_REJECTED",
                "Native SQL is disabled for this datasource.",
            )
        if query.spec.native.language.lower() != "sql":
            raise AdapterError(
                "NATIVE_QUERY_REJECTED",
                "ClickHouse native queries must use language=sql.",
            )
        statement = query.spec.native.statement.strip()
        if not statement or "\0" in statement:
            raise AdapterError(
                "NATIVE_QUERY_REJECTED",
                "Native SQL statement is empty or invalid.",
            )

        started = time.perf_counter()
        params: Dict[str, Any] = {
            "default_format": "JSONEachRow",
            "query": statement,
        }
        if self._config.database:
            params["database"] = self._config.database
        url = datasource_url(self._config.url, "", params)
        # ClickHouse JSONEachRow is newline-delimited; request text then parse.
        timeout = (timeout_ms or self._config.query_timeout_ms) / 1000.0
        import httpx

        headers = {"Accept": "application/json", **(self._config.http_headers or {})}
        if self._config.bearer_token:
            headers["Authorization"] = f"Bearer {self._config.bearer_token}"
        auth = None
        if self._config.username and self._config.password is not None:
            auth = httpx.BasicAuth(self._config.username, self._config.password)

        try:
            async with httpx.AsyncClient(timeout=timeout, auth=auth) as client:
                response = await client.post(self._config.url, params=params, headers=headers)
        except httpx.TimeoutException as exc:
            raise AdapterError("TIMEOUT", "ClickHouse request timed out.") from exc
        except httpx.HTTPError as exc:
            raise AdapterError(
                "TRANSPORT_ERROR", f"ClickHouse request failed: {exc}"
            ) from exc

        if response.status_code >= 400:
            raise AdapterError(
                "UPSTREAM_ERROR",
                f"ClickHouse returned HTTP {response.status_code}: {response.text[:500]}",
            )

        rows: List[Dict[str, Any]] = []
        text = response.text.strip()
        if text:
            import json

            for line in text.splitlines():
                line = line.strip()
                if line:
                    rows.append(json.loads(line))

        elapsed = (time.perf_counter() - started) * 1000
        frame = frame_from_rows(query.metadata.name, rows)
        return query_result(
            [frame],
            datasource="clickhouse",
            execution_time_ms=elapsed,
        )
