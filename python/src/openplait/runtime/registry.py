"""Named datasource registration (server-side only)."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Dict, Literal, Optional

from openplait.adapter_sdk.protocol import DatasourceAdapter
from openplait.runtime.errors import RuntimeError

DatasourceScope = Literal["dashboard", "workspace", "global"]


@dataclass
class RuntimeDatasourceRegistration:
    name: str
    kind: str
    adapter: DatasourceAdapter
    config: Any
    scope: DatasourceScope = "workspace"


class DatasourceRegistry:
    def __init__(self) -> None:
        self._by_name: Dict[str, RuntimeDatasourceRegistration] = {}

    def register(
        self, registration: RuntimeDatasourceRegistration
    ) -> "DatasourceRegistry":
        key = registration.name
        if key in self._by_name:
            raise RuntimeError(
                "DATASOURCE_EXISTS",
                f"Datasource '{key}' is already registered.",
            )
        validation = registration.adapter.validate_config(registration.config)
        if not validation.valid:
            details = "; ".join(f"{e.path}: {e.message}" for e in validation.errors)
            raise RuntimeError(
                "CONFIG_INVALID",
                f"Datasource '{key}' config invalid: {details}",
            )
        self._by_name[key] = registration
        return self

    def get(self, name: str) -> RuntimeDatasourceRegistration:
        try:
            return self._by_name[name]
        except KeyError as exc:
            raise RuntimeError(
                "DATASOURCE_NOT_FOUND",
                f"Datasource '{name}' is not registered.",
            ) from exc

    def list(self) -> Dict[str, RuntimeDatasourceRegistration]:
        return dict(self._by_name)
