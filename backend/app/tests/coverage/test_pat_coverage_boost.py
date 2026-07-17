"""Coverage boost for PAT audit/usage/rate-limit/registry and related helpers."""

from __future__ import annotations

import json
import uuid
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

import pytest
from fastapi import FastAPI
from pydantic import ValidationError

from app.core import api_key_digest, pat_audit, pat_rate_limit, pat_route_registry, pat_usage
from app.core.api_errors import PatApiError
from app.core.pat_route_registry import pat_allow
from app.schemas.webhook import WebhookEndpointCreate, WebhookEndpointUpdate
from app.services import api_token_service, pat_usage_service
from app.services.api_token_service import HASH_VERSION_V1

pytestmark = pytest.mark.coverage


# ---------------------------------------------------------------------------
# api_key_digest
# ---------------------------------------------------------------------------


def test_parse_pepper_map_edge_cases():
    assert api_key_digest.parse_pepper_map("") == {}
    assert api_key_digest.parse_pepper_map("   ") == {}
    with pytest.raises(ValueError, match="JSON object"):
        api_key_digest.parse_pepper_map("[]")
    with pytest.raises(ValueError, match="non-empty"):
        api_key_digest.parse_pepper_map('{"1":""}')
    parsed = api_key_digest.parse_pepper_map('{"1":"abc","2":"xyz"}')
    assert parsed[1] == b"abc"
    assert parsed[2] == b"xyz"


# ---------------------------------------------------------------------------
# pat_route_registry
# ---------------------------------------------------------------------------


def test_pat_allow_validation_and_inventory():
    with pytest.raises(ValueError, match="at least one scope"):
        pat_allow(authz_class="principal")  # type: ignore[call-arg]

    with pytest.raises(ValueError, match="Unknown PAT scope"):
        pat_allow("not:a:scope", authz_class="principal")

    with pytest.raises(ValueError, match="Invalid authz_class"):
        pat_allow("profile:read", authz_class="nope")  # type: ignore[arg-type]

    with pytest.raises(ValueError, match="Invalid rate_category"):
        pat_allow("profile:read", authz_class="principal", rate_category="turbo")  # type: ignore[arg-type]

    @pat_allow("profile:read", authz_class="principal", rate_category="standard", tenant_resolution="n/a")
    def sample_endpoint():
        return "ok"

    assert pat_route_registry.endpoint_pat_meta(None) is None
    assert pat_route_registry.endpoint_pat_meta(lambda: None) is None
    meta = pat_route_registry.endpoint_pat_meta(sample_endpoint)
    assert meta is not None
    assert "profile:read" in meta["scopes"]

    app = FastAPI()
    app.add_api_route("/demo", sample_endpoint, methods=["GET"])
    rows = pat_route_registry.collect_pat_routes(app)
    assert any(r["path"] == "/demo" for r in rows)
    md = pat_route_registry.render_pat_inventory_markdown(rows)
    assert "PAT route registry" in md
    assert "/demo" in md
    pat_route_registry.validate_pat_inventory(rows)

    with pytest.raises(ValueError, match="no scopes"):
        pat_route_registry.validate_pat_inventory(
            [{"path": "/x", "scopes": [], "authz_class": "principal"}]
        )
    with pytest.raises(ValueError, match="invalid authz_class"):
        pat_route_registry.validate_pat_inventory(
            [{"path": "/x", "scopes": ["profile:read"], "authz_class": "bad"}]
        )


# ---------------------------------------------------------------------------
# pat_audit (Redis aggregate + flush)
# ---------------------------------------------------------------------------


def test_record_denial_without_redis(caplog):
    with patch("app.core.pat_audit.get_redis_client", return_value=None):
        with caplog.at_level("INFO"):
            pat_audit.record_denial_aggregate(
                event="pat.route_denied",
                token_id=None,
                route="/api/v1/x",
                extra={"reason": "deny"},
            )
    assert "pat_denial" in caplog.text


def test_record_denial_redis_pipeline_and_error():
    pipe = MagicMock()
    client = MagicMock()
    client.pipeline.return_value = pipe
    with patch("app.core.pat_audit.get_redis_client", return_value=client):
        pat_audit.record_denial_aggregate(
            event="pat.scope_denied",
            token_id=uuid.uuid4(),
            route="/api/v1/tasks",
        )
    pipe.hincrby.assert_called()
    pipe.execute.assert_called_once()

    pipe.execute.side_effect = RuntimeError("redis down")
    with patch("app.core.pat_audit.get_redis_client", return_value=client):
        pat_audit.record_denial_aggregate(
            event="pat.scope_denied",
            token_id=uuid.uuid4(),
            route="/api/v1/tasks",
        )


def test_flush_denial_aggregates_writes_audit_rows(db):
    tid = uuid.uuid4()
    key = f"{pat_audit.DENIAL_KEY_PREFIX}pat.route_denied:{tid}:/api/v1/me"
    client = MagicMock()
    client.scan.side_effect = [
        (0, [key, f"{pat_audit.DENIAL_KEY_PREFIX}badname", "fd:pat:denial:skip"]),
    ]
    client.hgetall.side_effect = [
        {
            "count": "3",
            "first_ts": "1",
            "last_ts": "2",
            "meta": "{}",
        },
        {},
        {"count": "0"},
    ]
    with patch("app.core.pat_audit.get_redis_client", return_value=client):
        written = pat_audit.flush_denial_aggregates(db)
    assert written == 1
    client.delete.assert_called_with(key)

    with patch("app.core.pat_audit.get_redis_client", return_value=None):
        assert pat_audit.flush_denial_aggregates(db) == 0


def test_flush_denial_aggregates_handles_unknown_token_and_errors(db):
    key = f"{pat_audit.DENIAL_KEY_PREFIX}pat.scope_denied:not-a-uuid:/x"
    client = MagicMock()
    client.scan.return_value = (0, [key])
    client.hgetall.return_value = {"count": "2", "first_ts": "1", "last_ts": "2"}
    with patch("app.core.pat_audit.get_redis_client", return_value=client):
        assert pat_audit.flush_denial_aggregates(db) == 1

    client.scan.side_effect = RuntimeError("boom")
    with patch("app.core.pat_audit.get_redis_client", return_value=client):
        assert pat_audit.flush_denial_aggregates(db) == 0


def test_audit_pat_lifecycle_helpers(db, owner):
    tid = uuid.uuid4()
    pat_audit.audit_pat_created(db, actor_id=owner.id, token_id=tid, scopes=["profile:read"])
    pat_audit.audit_pat_rotated(
        db,
        actor_id=owner.id,
        new_token_id=uuid.uuid4(),
        old_token_id=tid,
        scopes=["profile:read"],
    )
    pat_audit.audit_pat_revoked(db, actor_id=owner.id, token_id=tid, reason="test")
    pat_audit.audit_pat_secret_acknowledged(db, actor_id=owner.id, token_id=tid)
    db.commit()


# ---------------------------------------------------------------------------
# pat_usage Redis path + derive edge cases
# ---------------------------------------------------------------------------


def _redis_pipeline_client():
    pipe = MagicMock()
    pipe.execute.return_value = [1] * 20
    client = MagicMock()
    client.pipeline.return_value = pipe
    client.ping.return_value = True
    return client, pipe


def test_record_and_read_usage_via_redis():
    tid = uuid.uuid4()
    client, pipe = _redis_pipeline_client()
    client.get.side_effect = lambda key: {
        pat_usage._req_key(str(tid)): "5",
        pat_usage._err_key(str(tid)): "2",
        pat_usage._rl_key(str(tid)): "1",
    }.get(key, "0")
    client.hgetall.return_value = {
        "last_success_at": "2026-07-14T00:00:00+00:00",
        "last_success_route": "/ok",
        "last_fail_at": "2026-07-14T01:00:00+00:00",
        "last_fail_route": "/bad",
        "last_fail_status": "500",
        "last_ip": "9.9.9.9",
    }
    client.lrange.return_value = [
        json.dumps({"at": "t", "event": "used", "detail": "200 /ok"}),
        "not-json",
    ]
    ep_key = pat_usage._ep_key(str(tid), "/ok")
    client.scan.side_effect = [(1, [ep_key]), (0, [])]
    client.get = MagicMock(
        side_effect=lambda key: "5" if key == pat_usage._req_key(str(tid)) else (
            "2" if key == pat_usage._err_key(str(tid)) else (
                "1" if key == pat_usage._rl_key(str(tid)) else (
                    "9" if key == ep_key else "0"
                )
            )
        )
    )

    with patch("app.core.pat_usage.get_redis_client", return_value=client):
        assert pat_usage.metrics_store_available() is True
        pat_usage.record_pat_usage(
            token_id=tid, route="/ok", status_code=200, ip_address="1.1.1.1"
        )
        pat_usage.record_pat_usage(token_id=tid, route="/bad", status_code=500)
        pat_usage.record_pat_usage(token_id=tid, route="/rl", status_code=429)
        snap = pat_usage.read_usage_snapshot(tid)

    assert snap["requests_24h"] == 5
    assert snap["errors_24h"] == 2
    assert snap["rate_limited_24h"] == 1
    assert snap["top_endpoint"] == "/ok"
    assert snap["last_fail_status"] == 500
    assert snap["timeline"][0]["event"] == "used"
    pipe.execute.assert_called()


def test_record_usage_redis_failure_falls_back_to_memory():
    pat_usage.clear_usage_memory_for_tests()
    tid = uuid.uuid4()
    client = MagicMock()
    pipe = MagicMock()
    pipe.execute.side_effect = RuntimeError("down")
    client.pipeline.return_value = pipe
    with patch("app.core.pat_usage.get_redis_client", return_value=client):
        with patch("app.core.pat_usage._allow_memory_fallback", return_value=True):
            pat_usage.record_pat_usage(token_id=tid, route="/x", status_code=200)
            # Force memory read path (redis client still present but write fell back)
            with patch("app.core.pat_usage.get_redis_client", return_value=None):
                with patch("app.core.pat_usage.metrics_store_available", return_value=True):
                    snap = pat_usage.read_usage_snapshot(tid)
    assert snap["requests_24h"] >= 1
    pat_usage.clear_usage_memory_for_tests()


def test_metrics_store_ping_failure_and_unavailable(monkeypatch):
    client = MagicMock()
    client.ping.side_effect = RuntimeError("nope")
    with patch("app.core.pat_usage.get_redis_client", return_value=client):
        with patch("app.core.pat_usage._allow_memory_fallback", return_value=False):
            assert pat_usage.metrics_store_available() is False
            snap = pat_usage.read_usage_snapshot(uuid.uuid4())
            assert snap["metrics_available"] is False


def test_derive_usage_status_failing_and_bad_iso():
    now = datetime(2026, 7, 14, tzinfo=timezone.utc)
    assert (
        pat_usage.derive_usage_status(
            revoked_at=None,
            expires_at=None,
            requests_24h=10,
            errors_24h=8,
            last_success_at=(now - timedelta(hours=2)).isoformat(),
            last_fail_at=now.isoformat(),
            now=now,
        )
        == "failing"
    )
    assert (
        pat_usage.derive_usage_status(
            revoked_at=None,
            expires_at=None,
            requests_24h=10,
            errors_24h=1,
            last_success_at="not-iso",
            last_fail_at="also-bad",
            now=now,
        )
        == "healthy"
    )


def test_top_endpoint_redis_skips_bad_counts():
    client = MagicMock()
    client.scan.return_value = (0, ["fd:pat:usage:t:ep:/a", "fd:pat:usage:t:ep:/b"])
    client.get.side_effect = [RuntimeError("x"), "3"]
    assert pat_usage._top_endpoint_redis(client, "t") == "/b"


# ---------------------------------------------------------------------------
# pat_rate_limit
# ---------------------------------------------------------------------------


def test_check_counter_redis_and_memory_paths(monkeypatch):
    monkeypatch.setenv("RATE_LIMIT_ENABLED", "true")
    pipe = MagicMock()
    pipe.execute.return_value = [1, True]
    client = MagicMock()
    client.pipeline.return_value = pipe

    with patch("app.core.pat_rate_limit.get_redis_client", return_value=client):
        pat_rate_limit.check_counter("k1", "standard", allow_memory_fallback=True)

    pipe.execute.return_value = [10_000, True]
    with patch("app.core.pat_rate_limit.get_redis_client", return_value=client):
        with pytest.raises(PatApiError) as exc:
            pat_rate_limit.check_counter("k2", "standard", allow_memory_fallback=True)
        assert exc.value.status_code == 429

    with patch("app.core.pat_rate_limit.get_redis_client", return_value=None):
        with patch("app.core.config.settings") as settings:
            settings.redis_enabled = False
            for _ in range(3):
                pat_rate_limit.check_counter(
                    f"mem-{uuid.uuid4()}", "expensive_read", allow_memory_fallback=True
                )

    with patch("app.core.pat_rate_limit.get_redis_client", return_value=None):
        with patch("app.core.config.settings") as settings:
            settings.redis_enabled = True
            with pytest.raises(PatApiError) as exc:
                pat_rate_limit.check_counter("k3", "standard", allow_memory_fallback=False)
            assert exc.value.status_code == 503

    # Redis INCR raises when redis is configured → 503
    boom_client = MagicMock()
    boom_client.pipeline.side_effect = RuntimeError("incr fail")
    with patch("app.core.pat_rate_limit.get_redis_client", return_value=boom_client):
        with patch("app.core.config.settings") as settings:
            settings.redis_enabled = True
            with pytest.raises(PatApiError) as exc:
                pat_rate_limit.check_counter("k4", "standard", allow_memory_fallback=True)
            assert exc.value.status_code == 503

    monkeypatch.setenv("RATE_LIMIT_ENABLED", "false")
    pat_rate_limit.check_counter("disabled", "standard", allow_memory_fallback=True)
    monkeypatch.setenv("RATE_LIMIT_ENABLED", "true")


def test_check_pat_limits_calls_org_and_ip(monkeypatch):
    monkeypatch.setenv("RATE_LIMIT_ENABLED", "true")
    request = MagicMock()
    request.client = SimpleNamespace(host="127.0.0.1")
    request.headers = {}
    with patch("app.core.pat_rate_limit.check_counter") as check:
        with patch("app.core.config.settings") as settings:
            settings.is_production = False
            settings.redis_enabled = False
            pat_rate_limit.check_pat_limits(
                token_id=uuid.uuid4(),
                organization_id=uuid.uuid4(),
                category="standard",
                request=request,
            )
    assert check.call_count == 3


# ---------------------------------------------------------------------------
# api_token_service lifecycle gaps
# ---------------------------------------------------------------------------


def test_cleanup_rename_pepper_report_and_verify_inactive(db, owner):
    raw, record = api_token_service.create_pat(
        db, user_id=owner.id, name="life", scopes=["profile:read"], expires_in_days=1
    )
    db.commit()

    report = api_token_service.pepper_migration_report(db)
    assert report["current_version"] >= 1
    assert any(k.startswith("pepper_") for k in report)

    # rename validation
    with pytest.raises(LookupError):
        api_token_service.rename_token(db, owner.id, uuid.uuid4(), name="x")
    with pytest.raises(ValueError, match="required"):
        api_token_service.rename_token(db, owner.id, record.id, name="   ")
    with pytest.raises(ValueError, match="120"):
        api_token_service.rename_token(db, owner.id, record.id, name="x" * 121)
    renamed = api_token_service.rename_token(db, owner.id, record.id, name=" renamed ")
    assert renamed.name == "renamed"

    # expire then cleanup
    record.expires_at = datetime.now(timezone.utc) - timedelta(hours=1)
    db.commit()
    assert api_token_service.verify_pat(db, raw) is None
    cleaned = api_token_service.cleanup_expired_pats(db)
    db.flush()
    assert cleaned >= 1
    assert record.revoked_at is not None
    with pytest.raises(ValueError, match="revoked"):
        api_token_service.rename_token(db, owner.id, record.id, name="nope")

    # apply_due_revocations
    raw2, record2 = api_token_service.create_pat(
        db, user_id=owner.id, name="grace", scopes=["profile:read"]
    )
    record2.revoke_at = datetime.now(timezone.utc) - timedelta(seconds=1)
    db.flush()
    assert api_token_service.verify_pat(db, raw2) is None
    n = api_token_service.apply_due_revocations(db)
    db.flush()
    assert n >= 1
    assert record2.revoked_at is not None


def test_parse_live_token_and_maybe_migrate_pepper(db, owner, monkeypatch):
    assert api_token_service._parse_live_token("fd_pat_legacy") is None
    assert api_token_service._parse_live_token("fd_live_") is None
    assert api_token_service._parse_live_token("fd_live_onlykid") is None

    peppers = json.dumps({"1": "pepper-one", "2": "pepper-two"})
    monkeypatch.setattr(
        "app.core.config.settings.API_KEY_PEPPERS",
        peppers,
    )
    monkeypatch.setattr(
        "app.core.config.settings.API_KEY_PEPPER_CURRENT",
        1,
    )
    api_key_digest.clear_pepper_cache()
    raw, record = api_token_service.create_pat(
        db, user_id=owner.id, name="migrate", scopes=["profile:read"]
    )
    assert record.hash_version == HASH_VERSION_V1
    assert record.pepper_version == 1

    monkeypatch.setattr(
        "app.core.config.settings.API_KEY_PEPPER_CURRENT",
        2,
    )
    api_key_digest.clear_pepper_cache()
    api_token_service.maybe_migrate_pepper(db, record, raw)
    assert record.pepper_version == 2
    db.commit()
    assert api_token_service.verify_pat(db, raw) is not None
    api_key_digest.clear_pepper_cache()


def test_build_token_usage_with_audits(db, owner):
    raw, record = api_token_service.create_pat(
        db, user_id=owner.id, name="usage-dash", scopes=["profile:read"]
    )
    db.commit()
    pat_audit.audit_pat_secret_acknowledged(db, actor_id=owner.id, token_id=record.id)
    api_token_service.revoke_token(db, owner.id, record.id, reason="manual")
    db.commit()

    # rotation lineage tip
    raw2, record2 = api_token_service.create_pat(
        db,
        user_id=owner.id,
        name="rotated",
        scopes=["profile:read"],
        rotated_from_id=record.id,
    )
    db.commit()
    pat_usage.clear_usage_memory_for_tests()
    pat_usage.record_pat_usage(token_id=record2.id, route="/api/v1/auth/me", status_code=200)

    payload = pat_usage_service.build_token_usage(db, record2)
    assert payload["token_id"] == record2.id
    assert payload["status"] in {"healthy", "idle", "degraded", "failing"}
    assert isinstance(payload["activity"], list)
    assert pat_usage_service.data_reason(SimpleNamespace(data={"reason": "x"})) == "x"
    assert pat_usage_service.data_reason(SimpleNamespace(data=None)) == "revoked"
    assert pat_usage_service._iso(None) is None
    naive = datetime(2026, 1, 1)
    assert "+00:00" in pat_usage_service._iso(naive) or "Z" in pat_usage_service._iso(naive) or naive.isoformat() in pat_usage_service._iso(naive)


# ---------------------------------------------------------------------------
# webhook schema validators
# ---------------------------------------------------------------------------


def test_webhook_event_validators():
    with pytest.raises(ValidationError):
        WebhookEndpointCreate(url="https://example.com/h", events=["  "])
    with pytest.raises(ValidationError):
        WebhookEndpointCreate(url="https://example.com/h", events=["not.real"])
    created = WebhookEndpointCreate(
        url="https://example.com/h",
        events=["task.created", "task.created", "*", "comment.added"],
    )
    assert created.events == ["*"]
    assert WebhookEndpointUpdate(events=None).events is None
    updated = WebhookEndpointUpdate(events=["task.updated", "task.updated"])
    assert updated.events == ["task.updated"]
