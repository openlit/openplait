"""Shared HTTP helpers for datasource adapters (mirrors @openplait/adapter-sdk)."""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Dict, Mapping, Optional
from urllib.parse import urlencode, urljoin, urlparse

import httpx

from openplait.adapter_sdk.errors import AdapterError
from openplait.adapter_sdk.types import AdapterValidationIssue


@dataclass
class HttpDatasourceConfig:
    """Common connection fields for HTTP-backed observability backends."""

    url: str
    username: Optional[str] = None
    password: Optional[str] = None
    bearer_token: Optional[str] = None
    tenant_id: Optional[str] = None
    http_headers: Dict[str, str] = field(default_factory=dict)
    allow_native_queries: bool = True
    query_timeout_ms: int = 30_000
    max_result_rows: Optional[int] = None
    max_time_range_ms: Optional[int] = None


def normalize_base_url(url: str) -> str:
    return url.rstrip("/")


def validate_http_url(
    url: str,
    *,
    path: str = "/url",
    label: str = "URL",
) -> list[AdapterValidationIssue]:
    errors: list[AdapterValidationIssue] = []
    if not url or not str(url).strip():
        errors.append(
            AdapterValidationIssue(
                code="CONFIG_INVALID",
                path=path,
                message=f"{label} is required.",
            )
        )
        return errors
    parsed = urlparse(url)
    if parsed.scheme not in ("http", "https"):
        errors.append(
            AdapterValidationIssue(
                code="CONFIG_INVALID",
                path=path,
                message=f"{label} must use http or https.",
            )
        )
    if parsed.query or parsed.fragment:
        errors.append(
            AdapterValidationIssue(
                code="CONFIG_INVALID",
                path=path,
                message=f"{label} cannot contain a query string or fragment.",
            )
        )
    return errors


def validate_auth_combo(config: HttpDatasourceConfig) -> list[AdapterValidationIssue]:
    errors: list[AdapterValidationIssue] = []
    has_user = bool(config.username and config.username.strip())
    has_pass = config.password is not None and config.password != ""
    has_bearer = bool(config.bearer_token and config.bearer_token.strip())
    if (has_user or has_pass) and has_bearer:
        errors.append(
            AdapterValidationIssue(
                code="CONFIG_INVALID",
                path="/",
                message="Use either basic auth or bearer token, not both.",
            )
        )
    if has_user != has_pass:
        errors.append(
            AdapterValidationIssue(
                code="CONFIG_INVALID",
                path="/username",
                message="Username and password must be provided together.",
            )
        )
    return errors


def build_headers(config: HttpDatasourceConfig) -> Dict[str, str]:
    headers = {"Accept": "application/json", **(config.http_headers or {})}
    if config.bearer_token and config.bearer_token.strip():
        headers["Authorization"] = f"Bearer {config.bearer_token.strip()}"
    if config.tenant_id and config.tenant_id.strip():
        headers["X-Scope-OrgID"] = config.tenant_id.strip()
    return headers


def build_auth(config: HttpDatasourceConfig) -> Optional[httpx.Auth]:
    if config.username and config.password is not None:
        return httpx.BasicAuth(config.username, config.password)
    return None


def datasource_url(
    base: str,
    path: str,
    params: Optional[Mapping[str, Any]] = None,
) -> str:
    joined = urljoin(f"{normalize_base_url(base)}/", path.lstrip("/"))
    if not params:
        return joined
    filtered = {
        key: value
        for key, value in params.items()
        if value is not None and value != ""
    }
    if not filtered:
        return joined
    return f"{joined}?{urlencode(filtered, doseq=True)}"


async def request_json(
    url: str,
    *,
    config: HttpDatasourceConfig,
    method: str = "GET",
    content: Optional[bytes | str] = None,
    headers_extra: Optional[Mapping[str, str]] = None,
    timeout_ms: Optional[int] = None,
    datasource_name: str = "datasource",
) -> Any:
    timeout = (timeout_ms or config.query_timeout_ms) / 1000.0
    headers = build_headers(config)
    if headers_extra:
        headers.update(headers_extra)
    try:
        async with httpx.AsyncClient(
            timeout=timeout,
            auth=build_auth(config),
            follow_redirects=True,
        ) as client:
            response = await client.request(
                method,
                url,
                headers=headers,
                content=content,
            )
    except httpx.TimeoutException as exc:
        raise AdapterError(
            "TIMEOUT",
            f"{datasource_name} request timed out after {timeout}s.",
        ) from exc
    except httpx.HTTPError as exc:
        raise AdapterError(
            "TRANSPORT_ERROR",
            f"{datasource_name} request failed: {exc}",
        ) from exc

    if response.status_code >= 400:
        body = response.text[:500]
        raise AdapterError(
            "UPSTREAM_ERROR",
            f"{datasource_name} returned HTTP {response.status_code}: {body}",
        )

    if not response.content:
        return None
    try:
        return response.json()
    except ValueError as exc:
        raise AdapterError(
            "INVALID_RESPONSE",
            f"{datasource_name} returned non-JSON response.",
        ) from exc


def coerce_config(data: Any, cls: type) -> Any:
    if isinstance(data, cls):
        return data
    if isinstance(data, dict):
        return cls(**data)
    raise TypeError(f"Expected {cls.__name__} or dict.")
