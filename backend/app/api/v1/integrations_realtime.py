"""Integration realtime WebSocket — PAT-authenticated duplex for external SaaS."""
from __future__ import annotations

import asyncio
import json
import logging

from fastapi import APIRouter, Depends, WebSocket, WebSocketDisconnect
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.api.deps import get_current_user, get_db
from app.core.api_token_scopes import SCOPE_REALTIME_READ, scopes_satisfy
from app.core.config import settings
from app.core.pat_route_registry import pat_allow
from app.core.websocket import ConnectionLimitError, manager
from app.core.ws_protocol import resolve_rooms, run_socket_loop
from app.db.session import SessionLocal
from app.models.api_token import PersonalAccessToken
from app.models.user import User
from app.services import api_token_service

logger = logging.getLogger(__name__)

router = APIRouter(tags=["realtime-integration"])


class IntegrationRealtimeMetaOut(BaseModel):
    websocket_path: str = "/api/v1/integrations/ws"
    auth: str = (
        "Authorization: Bearer <fd_live_...> on the WebSocket upgrade, "
        "or first message {\"type\":\"auth\",\"token\":\"...\"}"
    )
    required_scopes: list[str] = [SCOPE_REALTIME_READ]
    idle_timeout_seconds: int
    protocol: str = (
        "Server→client envelopes: {type, payload, ...ids}. "
        "Client→server: ping, subscribe/unsubscribe {resource, id}, ack."
    )


@router.get("/integrations/realtime", response_model=IntegrationRealtimeMetaOut)
@pat_allow(
    SCOPE_REALTIME_READ,
    rate_category="standard",
    authz_class="principal",
    tenant_resolution="No tenant; returns Integration WebSocket connection metadata for the PAT user",
)
def integration_realtime_meta(
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> IntegrationRealtimeMetaOut:
    """Documented PAT entrypoint for Integration WebSocket connection metadata."""
    _ = (user, db)
    return IntegrationRealtimeMetaOut(idle_timeout_seconds=settings.WS_IDLE_TIMEOUT_SECONDS)


def _extract_bearer(ws: WebSocket) -> str | None:
    auth = ws.headers.get("authorization") or ws.headers.get("Authorization")
    if not auth:
        return None
    parts = auth.split(None, 1)
    if len(parts) != 2 or parts[0].lower() != "bearer":
        return None
    return parts[1].strip() or None


def _load_pat_user(raw: str) -> tuple[User, PersonalAccessToken] | None:
    db = SessionLocal()
    try:
        if not api_token_service.is_pat_shaped(raw):
            return None
        pat = api_token_service.verify_pat(db, raw)
        if pat is None:
            return None
        if not scopes_satisfy(pat.scopes or [], SCOPE_REALTIME_READ):
            return None
        user = db.get(User, pat.user_id)
        if not user or not user.is_active or user.deleted_at is not None:
            return None
        api_token_service.maybe_migrate_pepper(db, pat, raw)
        api_token_service.touch_last_used(db, pat)
        db.commit()
        # Detach for use after session close
        db.expunge(user)
        db.expunge(pat)
        return user, pat
    except Exception:
        logger.exception("Integration WS PAT auth failed")
        db.rollback()
        return None
    finally:
        db.close()


async def _authenticate_integration(ws: WebSocket) -> tuple[User, PersonalAccessToken] | None:
    raw = _extract_bearer(ws)
    if raw:
        pair = _load_pat_user(raw)
        if pair is None:
            await ws.accept()
            await ws.close(code=4401, reason="Invalid token or missing realtime:read")
            return None
        await ws.accept()
        return pair

    # Auth-message fallback for clients that cannot set WS headers
    await ws.accept()
    try:
        raw_msg = await asyncio.wait_for(
            ws.receive_text(),
            timeout=float(settings.WS_AUTH_MESSAGE_TIMEOUT_SECONDS),
        )
        message = json.loads(raw_msg)
    except (asyncio.TimeoutError, json.JSONDecodeError, WebSocketDisconnect):
        await ws.close(code=4401, reason="Auth required")
        return None
    if not isinstance(message, dict) or message.get("type") != "auth":
        await ws.close(code=4401, reason="Auth required")
        return None
    token = message.get("token")
    if not token or not isinstance(token, str):
        await ws.close(code=4401, reason="Auth required")
        return None
    pair = _load_pat_user(token.strip())
    if pair is None:
        await ws.close(code=4401, reason="Invalid token or missing realtime:read")
        return None
    return pair


@router.websocket("/integrations/ws")
async def integration_websocket(ws: WebSocket):
    """Duplex Integration WebSocket for external SaaS (BrightWorks, bots, etc.)."""
    pair = await _authenticate_integration(ws)
    if pair is None:
        return
    user, pat = pair

    rooms, _ws_rooms = resolve_rooms(user)
    # Integration clients start with user room only; they subscribe explicitly.
    # Still auto-join entitled rooms so they receive events without subscribe dance,
    # matching app behavior for low-latency updates — subscribe can refine further.
    try:
        await manager.connect(
            ws,
            str(user.id),
            rooms,
            source="integration",
            token_id=str(pat.id),
        )
    except ConnectionLimitError as exc:
        await ws.close(code=4010, reason=str(exc)[:120])
        return

    await ws.send_text(
        json.dumps(
            {
                "type": "connected",
                "payload": {
                    "user_id": str(user.id),
                    "source": "integration",
                    "scopes": list(pat.scopes or []),
                },
            }
        )
    )

    try:
        await run_socket_loop(ws, user, allow_collab_relay=False)
    except WebSocketDisconnect:
        pass
    finally:
        await manager.disconnect(ws)
