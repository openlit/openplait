from openplait import OPENPLAIT_API_VERSION
from openplait.core import parse_query, validate_query


def test_parse_and_validate_semantic_query():
    document = {
        "apiVersion": OPENPLAIT_API_VERSION,
        "kind": "Query",
        "metadata": {"name": "spans-sample"},
        "spec": {
            "mode": "semantic",
            "datasource": {"kind": "ClickHouseDatasource", "name": "primary"},
            "input": {"signal": "traces", "entity": "otel.spans"},
            "select": [{"field": "service.name"}],
            "limit": 25,
        },
    }
    query = parse_query(document)
    result = validate_query(query)
    assert result.valid
    assert query.spec.mode == "semantic"
    assert query.spec.datasource.name == "primary"


def test_reject_empty_select():
    document = {
        "apiVersion": OPENPLAIT_API_VERSION,
        "kind": "Query",
        "metadata": {"name": "bad"},
        "spec": {
            "mode": "semantic",
            "datasource": {"kind": "ClickHouseDatasource", "name": "primary"},
            "input": {"signal": "traces", "entity": "otel.spans"},
            "select": [],
        },
    }
    result = validate_query(document)
    assert not result.valid
    assert any("select" in err for err in result.errors)
