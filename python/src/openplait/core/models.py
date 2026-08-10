"""Pydantic models for openplait.io/v1alpha1 query IR and results."""

from __future__ import annotations

from typing import Any, Dict, List, Literal, Optional, Union

from pydantic import BaseModel, ConfigDict, Field

from openplait.version import OPENPLAIT_API_VERSION

SignalType = Literal["metrics", "logs", "traces", "tabular"]
ComparisonOperator = Literal[
    "equals",
    "notEquals",
    "greaterThan",
    "greaterThanOrEqual",
    "lessThan",
    "lessThanOrEqual",
    "in",
    "notIn",
    "contains",
    "notContains",
    "startsWith",
    "endsWith",
    "matches",
]
NullComparisonOperator = Literal["isNull", "isNotNull"]
AggregateFunction = Literal[
    "count",
    "sum",
    "avg",
    "min",
    "max",
    "percentile",
    "distinctCount",
    "rate",
    "histogram",
]
DataFieldType = Literal[
    "string",
    "number",
    "boolean",
    "time",
    "duration",
    "trace",
    "json",
]


class OpenPlaitModel(BaseModel):
    model_config = ConfigDict(extra="allow", populate_by_name=True)


class ObjectMetadata(OpenPlaitModel):
    name: str
    display_name: Optional[str] = Field(default=None, alias="displayName")
    description: Optional[str] = None
    labels: Optional[Dict[str, str]] = None
    annotations: Optional[Dict[str, str]] = None


class DatasourceReference(OpenPlaitModel):
    kind: str
    name: str
    scope: Optional[Literal["dashboard", "workspace", "global"]] = None


class QueryInput(OpenPlaitModel):
    signal: SignalType
    entity: str


class TimeRange(OpenPlaitModel):
    field: str
    from_: Union[str, int, float, bool, None] = Field(alias="from")
    to: Union[str, int, float, bool, None]


class AggregateExpression(OpenPlaitModel):
    function: AggregateFunction
    field: Optional[str] = None
    percentile: Optional[float] = None
    interval: Optional[str] = None


class SelectField(OpenPlaitModel):
    field: str
    as_: Optional[str] = Field(default=None, alias="as")


class SelectAggregate(OpenPlaitModel):
    aggregate: AggregateExpression
    as_: str = Field(alias="as")


SelectExpression = Union[SelectField, SelectAggregate]


class OrderByExpression(OpenPlaitModel):
    field: str
    direction: Literal["asc", "desc"]


class GroupByField(OpenPlaitModel):
    field: str


class TimeBucket(OpenPlaitModel):
    field: str
    interval: str
    as_: Optional[str] = Field(default=None, alias="as")


class GroupByTimeBucket(OpenPlaitModel):
    time_bucket: TimeBucket = Field(alias="timeBucket")


GroupByExpression = Union[GroupByField, GroupByTimeBucket]


class SemanticQuerySpec(OpenPlaitModel):
    mode: Literal["semantic"] = "semantic"
    datasource: DatasourceReference
    input: QueryInput
    time_range: Optional[TimeRange] = Field(default=None, alias="timeRange")
    select: List[Dict[str, Any]]
    where: Optional[Dict[str, Any]] = None
    group_by: Optional[List[Dict[str, Any]]] = Field(default=None, alias="groupBy")
    order_by: Optional[List[OrderByExpression]] = Field(default=None, alias="orderBy")
    joins: Optional[List[Dict[str, Any]]] = None
    limit: Optional[int] = None
    parameters: Optional[Dict[str, Any]] = None
    extensions: Optional[Dict[str, Any]] = None


class NativeStatement(OpenPlaitModel):
    language: str
    statement: str


class NativeQuerySpec(OpenPlaitModel):
    mode: Literal["native"] = "native"
    datasource: DatasourceReference
    native: NativeStatement
    parameters: Optional[Dict[str, Any]] = None
    extensions: Optional[Dict[str, Any]] = None


class Query(OpenPlaitModel):
    api_version: Literal["openplait.io/v1alpha1"] = Field(
        default=OPENPLAIT_API_VERSION,
        alias="apiVersion",
    )
    kind: Literal["Query"] = "Query"
    metadata: ObjectMetadata
    spec: Union[SemanticQuerySpec, NativeQuerySpec]


class DataField(OpenPlaitModel):
    name: str
    type: DataFieldType
    values: List[Any]
    labels: Optional[Dict[str, str]] = None
    unit: Optional[str] = None


class FrameMetadata(OpenPlaitModel):
    preferred_visualisation: Optional[str] = Field(
        default=None, alias="preferredVisualisation"
    )
    custom: Optional[Dict[str, Any]] = None


class DataFrame(OpenPlaitModel):
    name: Optional[str] = None
    fields: List[DataField]
    length: int
    metadata: Optional[FrameMetadata] = None


class ExecutionMetadata(OpenPlaitModel):
    datasource: Optional[str] = None
    adapter_version: Optional[str] = Field(default=None, alias="adapterVersion")
    execution_time_ms: Optional[float] = Field(default=None, alias="executionTimeMs")
    rows_read: Optional[int] = Field(default=None, alias="rowsRead")
    rows_returned: Optional[int] = Field(default=None, alias="rowsReturned")
    cache: Optional[Literal["hit", "miss", "bypass"]] = None
    warnings: Optional[List[str]] = None
    trace_id: Optional[str] = Field(default=None, alias="traceId")


class QueryResult(OpenPlaitModel):
    frames: List[DataFrame]
    metadata: Optional[ExecutionMetadata] = None
