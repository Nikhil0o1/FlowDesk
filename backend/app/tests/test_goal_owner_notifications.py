"""Goal / target owner assignment inbox notifications."""

from sqlalchemy import select

from app.models.notification import Notification
from app.tests.conftest import auth_headers
from app.tests.helpers import add_project_member, build_project_stack


def test_goal_and_target_owner_assignment_notifications(client, db, org, owner):
    workspace, project = build_project_stack(db, org, owner)
    assignee = add_project_member(db, org, workspace, project, "goal-owner-notify@test.dev")
    # Needs Goals section access to patch goals as workspace admin path — use owner actor
    headers = auth_headers(client, "owner@test.dev")

    # Creating a goal owned by someone else → notify assignee
    goal = client.post(
        f"/api/v1/workspaces/{workspace.id}/goals",
        headers=headers,
        json={"name": "Owned Goal", "owner_id": str(assignee.id)},
    )
    assert goal.status_code == 201, goal.text
    goal_id = goal.json()["id"]

    notifs = db.scalars(
        select(Notification).where(
            Notification.user_id == assignee.id,
            Notification.type == "goal_owner_assigned",
        )
    ).all()
    assert len(notifs) == 1
    assert notifs[0].body == "Owned Goal"

    # Changing goal owner → notifies new owner
    other = add_project_member(db, org, workspace, project, "goal-owner-2@test.dev")
    patched = client.patch(
        f"/api/v1/goals/{goal_id}",
        headers=headers,
        json={"owner_id": str(other.id)},
    )
    assert patched.status_code == 200, patched.text
    assert (
        db.scalar(
            select(Notification).where(
                Notification.user_id == other.id,
                Notification.type == "goal_owner_assigned",
            )
        )
        is not None
    )

    # Target owner on create
    target = client.post(
        f"/api/v1/goals/{goal_id}/targets",
        headers=headers,
        json={"title": "Delivery", "owner_id": str(assignee.id), "target_type": "tasks"},
    )
    assert target.status_code == 201, target.text
    target_id = target.json()["id"]
    assert (
        db.scalar(
            select(Notification).where(
                Notification.user_id == assignee.id,
                Notification.type == "goal_target_owner_assigned",
            )
        )
        is not None
    )

    # Target owner change
    updated = client.patch(
        f"/api/v1/targets/{target_id}",
        headers=headers,
        json={"owner_id": str(other.id)},
    )
    assert updated.status_code == 200, updated.text
    assert (
        db.scalar(
            select(Notification).where(
                Notification.user_id == other.id,
                Notification.type == "goal_target_owner_assigned",
            )
        )
        is not None
    )

    # Self-assign must not notify
    before = len(
        db.scalars(
            select(Notification).where(Notification.user_id == owner.id)
        ).all()
    )
    self_owned = client.post(
        f"/api/v1/workspaces/{workspace.id}/goals",
        headers=headers,
        json={"name": "Mine", "owner_id": str(owner.id)},
    )
    assert self_owned.status_code == 201, self_owned.text
    after = len(
        db.scalars(
            select(Notification).where(Notification.user_id == owner.id)
        ).all()
    )
    assert after == before
