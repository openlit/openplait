import pytest

from openplait.adapters import ClickHouseAdapter, ClickHouseConfig
from openplait.runtime import DatasourceRegistry, RuntimeError
from openplait.runtime.registry import RuntimeDatasourceRegistration


def test_registry_accepts_valid_clickhouse():
    adapter = ClickHouseAdapter(ClickHouseConfig(url="http://localhost:8123"))
    registry = DatasourceRegistry().register(
        RuntimeDatasourceRegistration(
            name="primary",
            kind="ClickHouseDatasource",
            adapter=adapter,
            config=ClickHouseConfig(url="http://localhost:8123", database="openlit"),
        )
    )
    assert registry.get("primary").kind == "ClickHouseDatasource"


def test_registry_rejects_bad_url():
    adapter = ClickHouseAdapter(ClickHouseConfig(url="http://localhost:8123"))
    registry = DatasourceRegistry()
    with pytest.raises(RuntimeError) as exc:
        registry.register(
            RuntimeDatasourceRegistration(
                name="primary",
                kind="ClickHouseDatasource",
                adapter=adapter,
                config=ClickHouseConfig(url="ftp://bad"),
            )
        )
    assert exc.value.code == "CONFIG_INVALID"
