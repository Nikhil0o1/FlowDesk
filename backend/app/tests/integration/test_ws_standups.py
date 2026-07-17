"""Integration — WebSocket ticket API and sprint standups."""
from datetime import date

import pytest

from app.tests.conftest import auth_headers
from app.tests.helpers import build_project_stack


@pytest.mark.integration
def test_ws_ticket_issue_and_single_use(client, owner):
    headers = auth_headers(client, owner.email)

    issue = client.post("/api/v1/ws/ticket", headers=headers)
    assert issue.status_code == 200
    ticket = issue.json()["ticket"]
    assert ticket
    assert issue.json()["expires_in"] > 0

    from app.services import ws_ticket_service

    user_id = ws_ticket_service.redeem_ws_ticket(ticket)
    assert user_id == owner.id
    assert ws_ticket_service.redeem_ws_ticket(ticket) is None


@pytest.mark.integration
def test_sprint_standup_submit_and_list(client, db, org, owner):
    workspace, _ = build_project_stack(db, org, owner)
    headers = auth_headers(client, owner.email)

    sprint = client.post(
        f"/api/v1/workspaces/{workspace.id}/sprints",
        headers=headers,
        json={"name": "Standup Sprint"},
    )
    assert sprint.status_code == 201
    sprint_id = sprint.json()["id"]

    today = date.today().isoformat()
    submit = client.post(
        f"/api/v1/sprints/{sprint_id}/standups",
        headers=headers,
        json={
            "for_date": today,
            "yesterday": "Finished API tests",
            "today": "Wire standups UI",
            "blockers": "None",
        },
    )
    assert submit.status_code == 201
    assert submit.json()["today"] == "Wire standups UI"

    listed = client.get(f"/api/v1/sprints/{sprint_id}/standups", headers=headers, params={"for_date": today})
    assert listed.status_code == 200
    assert listed.json()["total"] >= 1


@pytest.mark.integration
def test_websocket_rejects_invalid_ticket(client):
    from starlette.websockets import WebSocketDisconnect

    with pytest.raises(WebSocketDisconnect):
        with client.websocket_connect("/api/v1/ws?ticket=not-a-valid-ticket") as ws:
            ws.receive_text()
