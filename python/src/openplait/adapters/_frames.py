"""Shared dataframe helpers for Python adapters."""

from __future__ import annotations

from typing import Any, Dict, List, Sequence

from openplait.core.models import (
    DataField,
    DataFrame,
    ExecutionMetadata,
    QueryResult,
)
from openplait.version import OPENPLAIT_SPEC_VERSION


def frame_from_rows(
    name: str,
    rows: Sequence[Dict[str, Any]],
    *,
    field_types: Dict[str, str] | None = None,
) -> DataFrame:
    if not rows:
        return DataFrame(name=name, fields=[], length=0)
    keys = list(rows[0].keys())
    types = field_types or {}
    fields: List[DataField] = []
    for key in keys:
        values = [row.get(key) for row in rows]
        fields.append(
            DataField(
                name=key,
                type=types.get(key, _infer_type(values)),  # type: ignore[arg-type]
                values=values,
            )
        )
    return DataFrame(name=name, fields=fields, length=len(rows))


def query_result(
    frames: List[DataFrame],
    *,
    datasource: str,
    execution_time_ms: float,
    warnings: List[str] | None = None,
) -> QueryResult:
    rows = sum(frame.length for frame in frames)
    return QueryResult(
        frames=frames,
        metadata=ExecutionMetadata(
            datasource=datasource,
            adapterVersion=OPENPLAIT_SPEC_VERSION,
            executionTimeMs=execution_time_ms,
            rowsRead=rows,
            rowsReturned=rows,
            warnings=warnings or None,
        ),
    )


def _infer_type(values: Sequence[Any]) -> str:
    for value in values:
        if value is None:
            continue
        if isinstance(value, bool):
            return "boolean"
        if isinstance(value, (int, float)):
            return "number"
        if isinstance(value, (dict, list)):
            return "json"
        return "string"
    return "string"
