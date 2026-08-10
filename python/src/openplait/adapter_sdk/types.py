"""Shared adapter type aliases."""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Dict, Generic, List, Literal, Optional, TypeVar, Union

from openplait.core.models import SignalType

T = TypeVar("T")


@dataclass
class AdapterManifest:
    name: str
    display_name: str
    version: str
    query_languages: List[str]
    signals: List[SignalType]


@dataclass
class AdapterValidationIssue:
    code: str
    path: str
    message: str


@dataclass
class AdapterValidationResult(Generic[T]):
    valid: bool
    value: Optional[T] = None
    errors: List[AdapterValidationIssue] = field(default_factory=list)


@dataclass
class JoinCapabilities:
    local: bool = False
    cross_datasource: bool = False


@dataclass
class DatasourceCapabilities:
    signals: List[SignalType]
    operations: List[str]
    joins: JoinCapabilities = field(default_factory=JoinCapabilities)
    native_query_languages: Optional[List[str]] = None
    explain: bool = False
    schema_discovery: bool = False
    limits: Optional[Dict[str, Any]] = None
    extensions: Optional[Dict[str, Any]] = None


QueryOperation = Literal[
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
    "join",
]
