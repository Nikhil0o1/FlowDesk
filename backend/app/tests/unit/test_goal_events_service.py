"""Unit tests for goal_events_service helpers."""

import uuid

import pytest
from sqlalchemy import select

from app.models.goal import Goal
from app.models.notification import Notification
from app.services.goal_events_service import actor_display_name, notify_goal_completed
from app.services.member_candidates import goal_owner_candidate_user_ids
from app.tests.conftest import make_user
from app.tests.helpers import build_project_stack


@pytest.mark.unit
def test_actor_display_name_prefers_profile(db, org, owner):
    assert actor_display_name(owner) == "Owner"


@pytest.mark.unit
def test_actor_display_name_falls_back_to_email(db):
    from app.models.user import Profile

    user = make_user(db, "no-profile@test.dev")
    profile = db.scalar(select(Profile).where(Profile.user_id == user.id))
    db.delete(profile)
    db.flush()
    db.expire(user, ["profile"])
    assert actor_display_name(user) == "no-profile@test.dev"


@pytest.mark.unit
def test_notify_goal_completed_skips_self_notification(db, org, owner):
    workspace, _project = build_project_stack(db, org, owner)
    goal = Goal(
        workspace_id=workspace.id,
        name="Done",
        owner_id=owner.id,
        created_by=owner.id,
        is_private=False,
    )
    db.add(goal)
    db.flush()

    before = len(db.scalars(select(Notification)).all())
    notify_goal_completed(db, goal=goal, user_id=owner.id, actor_id=owner.id)
    db.flush()
    after = len(db.scalars(select(Notification)).all())
    assert after == before


@pytest.mark.unit
def test_goal_owner_candidates_empty_for_missing_workspace(db):
    assert goal_owner_candidate_user_ids(db, uuid.uuid4()) == set()
