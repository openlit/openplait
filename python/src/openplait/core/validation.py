"""Lightweight validation helpers for OpenPlait Query resources."""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import List, Union

from pydantic import ValidationError

from openplait.core.models import Query
from openplait.core.serialization import parse_query


@dataclass
class ValidationResult:
    valid: bool
    errors: List[str] = field(default_factory=list)


def validate_query(document: Union[Query, dict, str]) -> ValidationResult:
    """Validate a Query resource (already parsed or raw)."""
    try:
        query = document if isinstance(document, Query) else parse_query(document)
    except (ValidationError, ValueError, TypeError) as exc:
        return ValidationResult(valid=False, errors=[str(exc)])

    errors: List[str] = []
    if query.kind != "Query":
        errors.append("kind must be Query")
    if query.spec.mode == "semantic":
        if not query.spec.select:
            errors.append("semantic queries require a non-empty select")
        if query.spec.limit is not None and query.spec.limit < 1:
            errors.append("limit must be >= 1 when set")
    elif query.spec.mode == "native":
        if not query.spec.native.language or not query.spec.native.statement:
            errors.append("native queries require language and statement")
    else:
        errors.append("unknown query mode")

    if not query.spec.datasource.kind or not query.spec.datasource.name:
        errors.append("datasource.kind and datasource.name are required")

    return ValidationResult(valid=len(errors) == 0, errors=errors)
