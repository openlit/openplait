"""OpenPlaitRuntime — resolve datasource refs and execute queries."""

from __future__ import annotations

from typing import Any, Dict, Optional

from openplait.core.models import Query, QueryResult
from openplait.core.validation import validate_query
from openplait.runtime.errors import RuntimeError
from openplait.runtime.registry import DatasourceRegistry


class OpenPlaitRuntime:
    def __init__(
        self,
        registry: DatasourceRegistry,
        *,
        default_timeout_ms: int = 30_000,
    ) -> None:
        self._registry = registry
        self._default_timeout_ms = default_timeout_ms

    async def execute(
        self,
        query: Query,
        *,
        variables: Optional[Dict[str, Any]] = None,
        timeout_ms: Optional[int] = None,
    ) -> QueryResult:
        del variables  # reserved for parameter binding in later milestones
        result = validate_query(query)
        if not result.valid:
            raise RuntimeError(
                "QUERY_INVALID",
                "; ".join(result.errors) or "Query validation failed.",
            )

        handle = self._registry.get(query.spec.datasource.name)
        if handle.kind != query.spec.datasource.kind:
            raise RuntimeError(
                "DATASOURCE_KIND_MISMATCH",
                f"Registered kind '{handle.kind}' does not match "
                f"query datasource kind '{query.spec.datasource.kind}'.",
            )

        return await handle.adapter.execute(
            query,
            config=handle.config,
            timeout_ms=timeout_ms or self._default_timeout_ms,
        )
