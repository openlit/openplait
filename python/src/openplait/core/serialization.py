"""Parse and serialize OpenPlait documents."""

from __future__ import annotations

import json
from typing import Any, Dict, Literal, Union

import yaml

from openplait.core.models import Query

SerializationFormat = Literal["json", "yaml"]


def parse_query(document: Union[str, Dict[str, Any]]) -> Query:
    """Parse a Query resource from a dict or JSON/YAML string."""
    if isinstance(document, str):
        text = document.strip()
        if not text:
            raise ValueError("Empty query document.")
        if text.startswith("{"):
            payload = json.loads(text)
        else:
            payload = yaml.safe_load(text)
    else:
        payload = document
    if not isinstance(payload, dict):
        raise ValueError("Query document must be an object.")
    return Query.model_validate(payload)


def serialize_document(
    document: Query,
    *,
    format: SerializationFormat = "json",
) -> str:
    """Serialize a Query resource to JSON or YAML."""
    data = document.model_dump(by_alias=True, exclude_none=True)
    if format == "yaml":
        return yaml.safe_dump(data, sort_keys=False)
    return json.dumps(data, indent=2)
