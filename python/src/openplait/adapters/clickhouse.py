"""ClickHouse adapter scaffold (full compile/execute ports from TypeScript next)."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Optional
from urllib.parse import urlparse

from openplait.adapter_sdk.errors import AdapterError
from openplait.adapter_sdk.types import (
    AdapterManifest,
    AdapterValidationIssue,
    AdapterValidationResult,
    DatasourceCapabilities,
    JoinCapabilities,
)
from openplait.core.models import Query, QueryResult
from openplait.version import OPENPLAIT_SPEC_VERSION


@dataclass
class ClickHouseConfig:
    url: str
    username: Optional[str] = None
    password: Optional[str] = None
    database: Optional[str] = None


class ClickHouseAdapter:
    """Skeleton aligned with @openplait/adapter-clickhouse.

    Config validation and capabilities are implemented. Semantic compile/execute
    will track the TypeScript reference adapter.
    """

    def __init__(self, config: ClickHouseConfig) -> None:
        validation = self.validate_config(config)
        if not validation.valid:
            raise AdapterError(
                "CONFIG_INVALID",
                "; ".join(e.message for e in validation.errors),
            )
        self._config = validation.value or config

    @property
    def manifest(self) -> AdapterManifest:
        return AdapterManifest(
            name="clickhouse",
            display_name="ClickHouse",
            version=OPENPLAIT_SPEC_VERSION,
            query_languages=["sql"],
            signals=["metrics", "logs", "traces", "tabular"],
        )

    def validate_config(
        self, config: Any
    ) -> AdapterValidationResult[ClickHouseConfig]:
        if isinstance(config, dict):
            try:
                config = ClickHouseConfig(**config)
            except TypeError as exc:
                return AdapterValidationResult(
                    valid=False,
                    errors=[
                        AdapterValidationIssue(
                            code="CONFIG_INVALID",
                            path="/",
                            message=str(exc),
                        )
                    ],
                )
        if not isinstance(config, ClickHouseConfig):
            return AdapterValidationResult(
                valid=False,
                errors=[
                    AdapterValidationIssue(
                        code="CONFIG_INVALID",
                        path="/",
                        message="Expected ClickHouseConfig.",
                    )
                ],
            )
        errors = []
        if not config.url:
            errors.append(
                AdapterValidationIssue(
                    code="CONFIG_INVALID",
                    path="/url",
                    message="URL is required.",
                )
            )
        else:
            parsed = urlparse(config.url)
            if parsed.scheme not in ("http", "https"):
                errors.append(
                    AdapterValidationIssue(
                        code="CONFIG_INVALID",
                        path="/url",
                        message="ClickHouse URL must use http or https.",
                    )
                )
        if errors:
            return AdapterValidationResult(valid=False, errors=errors)
        return AdapterValidationResult(valid=True, value=config, errors=[])

    async def get_capabilities(
        self, config: Any
    ) -> DatasourceCapabilities:
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
            ],
            joins=JoinCapabilities(local=True, cross_datasource=False),
            native_query_languages=["sql"],
            explain=True,
            schema_discovery=True,
        )

    async def execute(
        self,
        query: Query,
        *,
        config: Any,
        timeout_ms: Optional[int] = None,
    ) -> QueryResult:
        del query, config, timeout_ms
        raise AdapterError(
            "NOT_IMPLEMENTED",
            "Python ClickHouse execute is not implemented yet; "
            "use @openplait/adapter-clickhouse on Node, or contribute the port.",
        )
