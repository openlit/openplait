"""DatasourceAdapter protocol — keep backend details inside adapters."""

from __future__ import annotations

from typing import Any, Optional, Protocol, runtime_checkable

from openplait.adapter_sdk.types import (
    AdapterManifest,
    AdapterValidationResult,
    DatasourceCapabilities,
)
from openplait.core.models import Query, QueryResult


@runtime_checkable
class DatasourceAdapter(Protocol):
    """Minimal portable adapter surface (mirrors @openplait/adapter-sdk)."""

    @property
    def manifest(self) -> AdapterManifest: ...

    def validate_config(self, config: Any) -> AdapterValidationResult[Any]: ...

    async def get_capabilities(self, config: Any) -> DatasourceCapabilities: ...

    async def execute(
        self,
        query: Query,
        *,
        config: Any,
        timeout_ms: Optional[int] = None,
    ) -> QueryResult: ...
