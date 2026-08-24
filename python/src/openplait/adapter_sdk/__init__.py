"""Adapter contracts for OpenPlait Python backends."""

from openplait.adapter_sdk.errors import AdapterError
from openplait.adapter_sdk.http import HttpDatasourceConfig, datasource_url, request_json
from openplait.adapter_sdk.protocol import DatasourceAdapter
from openplait.adapter_sdk.types import (
    AdapterManifest,
    AdapterValidationIssue,
    AdapterValidationResult,
    DatasourceCapabilities,
)

__all__ = [
    "AdapterError",
    "AdapterManifest",
    "AdapterValidationIssue",
    "AdapterValidationResult",
    "DatasourceAdapter",
    "DatasourceCapabilities",
    "HttpDatasourceConfig",
    "datasource_url",
    "request_json",
]
