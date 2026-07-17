"""Phase 2 unit tests — @mention parsing and fan-out rules."""
import uuid

import pytest

from app.services.mention_service import (
    create_mentions,
    doc_body_mention_excerpt,
    excerpt,
    extract_doc_html_people_ids,
    extract_mentioned_user_ids,
    mentions_everyone,
    notify_new_doc_body_mentions,
    plain_text_from_rich_body,
)


@pytest.mark.unit
def test_extract_mentioned_user_ids_dedupes():
    uid = uuid.uuid4()
    body = f"Hello @[Alice]({uid}) and @[Alice again]({uid})"
    ids = extract_mentioned_user_ids(body)
    assert ids == [uid]


@pytest.mark.unit
def test_extract_ignores_malformed_uuid_token(monkeypatch):
    import uuid as uuid_mod

    original = uuid_mod.UUID

    def strict_uuid(value):
        if value == "00000000-0000-0000-0000-000000000000":
            raise ValueError("bad uuid")
        return original(value)

    monkeypatch.setattr("app.services.mention_service.uuid.UUID", strict_uuid)
    body = "@[Bad](00000000-0000-0000-0000-000000000000)"
    assert extract_mentioned_user_ids(body) == []


@pytest.mark.unit
def test_mentions_everyone_detects_all_sentinel():
    assert mentions_everyone("Hey @[All](all)") is True
    assert mentions_everyone('Hey <span data-mention-id="all" data-mention-type="people">@All</span>') is True
    assert mentions_everyone("no mentions here") is False


@pytest.mark.unit
def test_excerpt_strips_markup_and_truncates():
    uid = uuid.uuid4()
    long_body = f"@[Alice]({uid}) " + ("x" * 300)
    text = excerpt(long_body, limit=50)
    assert "@Alice" in text
    assert "](" not in text
    assert text.endswith("…")


@pytest.mark.unit
def test_excerpt_decodes_nbsp_and_strips_html():
    uid = uuid.uuid4()
    html_body = (
        f'<p>hi&nbsp;&nbsp;<span data-mention-type="people" data-mention-id="{uid}">'
        f"@bot</span>&nbsp;how are&nbsp;u</p>"
    )
    text = excerpt(html_body)
    assert "&nbsp;" not in text
    assert "<" not in text
    assert text == "hi @bot how are u"


@pytest.mark.unit
def test_doc_body_mention_excerpt_centers_on_chip():
    uid = uuid.uuid4()
    html_body = (
        "<p>"
        + ("word " * 40)
        + f'<span data-mention-type="people" data-mention-id="{uid}">@bot</span>'
        + (" tail " * 40)
        + "</p>"
    )
    text = doc_body_mention_excerpt(html_body, uid, limit=80)
    assert "@bot" in text
    assert "&nbsp;" not in text
    assert len(text) <= 81  # allow ellipsis


def test_doc_body_all_mention_excerpt_does_not_duplicate_all():
    from app.services.mention_service import doc_body_all_mention_excerpt

    html_body = (
        '<p>Ping <span data-mention-type="people" data-mention-id="abc">@bot</span> '
        '<span class="doc-mention" data-mention-type="people" data-mention-id="all"'
        ' contenteditable="false">@All</span></p>'
    )
    text = doc_body_all_mention_excerpt(html_body)
    assert text.count("@All") == 1
    assert "@bot" in text


@pytest.mark.unit
def test_plain_text_from_rich_body_collapses_entities():
    assert plain_text_from_rich_body("a&nbsp;&nbsp;b&amp;c") == "a b&c"


@pytest.mark.unit
def test_create_mentions_skips_outside_allowed_set(db, org, owner):
    workspace_user = uuid.uuid4()
    body = f"@[Ghost]({workspace_user})"
    created = create_mentions(
        db,
        body=body,
        author=owner,
        allowed_user_ids={owner.id},
        context_label="Task",
        url="https://app.test/t/1",
    )
    assert created == []


@pytest.mark.unit
def test_create_mentions_notifies_allowed_user(db, org, owner):
    from sqlalchemy import select

    from app.models.comment import Comment
    from app.models.notification import Notification
    from app.tests.conftest import make_user
    from app.tests.helpers import add_task, build_project_stack

    workspace, project = build_project_stack(db, org, owner)
    task = add_task(db, project, owner)
    comment = Comment(task_id=task.id, author_id=owner.id, body="hi")
    db.add(comment)
    db.flush()

    target_user = make_user(db, "mention-real@test.dev")
    body = f"Hi @[Target]({target_user.id})"

    created = create_mentions(
        db,
        body=body,
        author=owner,
        allowed_user_ids={owner.id, target_user.id},
        comment_id=comment.id,
        context_label="Task ABC",
        url="https://app.test/t/1",
        email_important_only=True,
    )
    assert target_user.id in created
    notif = db.scalar(select(Notification).where(Notification.user_id == target_user.id))
    assert notif is not None
    assert notif.type == "comment_mention"


@pytest.mark.unit
def test_create_mentions_expands_all_to_allowed_users(db, org, owner):
    from app.tests.conftest import make_user

    target = make_user(db, "mention-all@test.dev")
    created = create_mentions(
        db,
        body="Heads up @[All](all)",
        author=owner,
        allowed_user_ids={owner.id, target.id},
        context_label="Quarterly Doc",
        url="https://app.test/docs/1",
        notification_type="doc_mention",
    )
    assert target.id in created


@pytest.mark.unit
def test_create_mentions_skips_inactive_user(db, org, owner):
    from sqlalchemy import select

    from app.models.notification import Notification
    from app.models.user import User
    from app.tests.conftest import make_user

    inactive = make_user(db, "mention-inactive@test.dev")
    inactive.is_active = False
    db.flush()

    body = f"@[Inactive]({inactive.id})"
    created = create_mentions(
        db,
        body=body,
        author=owner,
        allowed_user_ids={owner.id, inactive.id},
        context_label="Doc",
        url="https://app.test/docs/2",
        notification_type="doc_mention",
    )
    assert created == []
    assert db.scalar(select(Notification).where(Notification.user_id == inactive.id)) is None
    inactive_row = db.get(User, inactive.id)
    assert inactive_row is not None
    assert inactive_row.is_active is False


@pytest.mark.unit
def test_extract_doc_html_people_ids_from_chips():
    uid = uuid.uuid4()
    html = (
        f'<p>Hey <span class="doc-mention" data-mention-type="people" '
        f'data-mention-id="{uid}" contenteditable="false">@Alice</span></p>'
    )
    assert extract_doc_html_people_ids(html) == [uid]


@pytest.mark.unit
def test_extract_doc_html_people_ids_attr_order_reversed():
    uid = uuid.uuid4()
    html = f'<span data-mention-id="{uid}" data-mention-type="people">@Bob</span>'
    assert extract_doc_html_people_ids(html) == [uid]


@pytest.mark.unit
def test_notify_new_doc_body_mentions_only_added(db, org, owner):
    from sqlalchemy import select

    from app.models.notification import Notification
    from app.tests.conftest import make_user
    from app.tests.helpers import build_project_stack

    workspace, _ = build_project_stack(db, org, owner)
    alice = make_user(db, "doc-body-alice@test.dev")
    bob = make_user(db, "doc-body-bob@test.dev")
    prev = (
        f'<span data-mention-type="people" data-mention-id="{alice.id}">@Alice</span>'
    )
    nxt = (
        f'{prev} and '
        f'<span data-mention-type="people" data-mention-id="{bob.id}">@Bob</span>'
    )
    doc_id = uuid.uuid4()
    created = notify_new_doc_body_mentions(
        db,
        author=owner,
        allowed_user_ids={owner.id, alice.id, bob.id},
        document_id=doc_id,
        previous_html=prev,
        next_html=nxt,
        context_label='"Spec"',
        url="https://app.test/docs/x",
        workspace_id=workspace.id,
    )
    assert created == [bob.id]
    notif = db.scalar(select(Notification).where(Notification.user_id == bob.id))
    assert notif is not None
    assert notif.type == "doc_mention"
    assert notif.data.get("document_id") == str(doc_id)
    assert notif.body is not None
    assert "&nbsp;" not in notif.body
    assert "<span" not in notif.body
    assert "@Bob" in notif.body
    assert db.scalar(select(Notification).where(Notification.user_id == alice.id)) is None
