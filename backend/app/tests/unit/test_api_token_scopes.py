from app.core.api_token_scopes import (
    ALL_SCOPES,
    DEFAULT_CREATE_SCOPES,
    DEFAULT_MCP_SCOPES,
    PHASE1_SCOPES,
    normalize_scopes,
)


def test_create_defaults_empty():
    assert DEFAULT_CREATE_SCOPES == []
    assert DEFAULT_MCP_SCOPES == []
    assert normalize_scopes(None) == []
    assert normalize_scopes([]) == []


def test_phase1_scopes_subset():
    assert PHASE1_SCOPES.issubset(ALL_SCOPES)
    assert "profile:read" in PHASE1_SCOPES
    assert "organizations:read" in PHASE1_SCOPES
    assert "comments:read" in PHASE1_SCOPES


def test_normalize_known_scopes():
    assert normalize_scopes(["tasks:read", "tasks:write"]) == ["tasks:read", "tasks:write"]


def test_normalize_rejects_unknown():
    try:
        normalize_scopes(["not:a:scope"])
        assert False, "expected ValueError"
    except ValueError as exc:
        assert "Unknown scope" in str(exc)
