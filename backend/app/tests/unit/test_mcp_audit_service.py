"""Unit tests for MCP audit service."""

from app.services import api_token_service, mcp_audit_service


def test_log_and_list_invocation(db, owner):
    raw, token = api_token_service.create_pat(
        db,
        user_id=owner.id,
        name="audit",
        scopes=["tasks:read"],
    )
    db.commit()

    row = mcp_audit_service.log_invocation(
        db,
        user_id=owner.id,
        token_id=token.id,
        tool="flowdesk_whoami",
        args_hash="a" * 64,
        status="ok",
        duration_ms=12,
    )
    db.commit()

    listed = mcp_audit_service.list_user_invocations(db, owner.id, limit=5)
    assert listed
    hit, prefix = listed[0]
    assert hit.id == row.id
    assert hit.tool == "flowdesk_whoami"
    assert prefix == token.token_prefix
