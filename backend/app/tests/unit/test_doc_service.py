"""Unit tests for doc_service filter/sort helpers."""
import uuid
from datetime import datetime, timezone

import pytest

from unittest.mock import MagicMock

from app.models.document import Document
from app.services import doc_service

pytestmark = pytest.mark.unit


def test_display_name_fallbacks():
    assert doc_service.display_name(None) == "Unknown"

    class _Profile:
        full_name = "Alice"

    class _User:
        email = "a@example.com"
        profile = _Profile()

    class _UserNoProfile:
        email = "bob@example.com"
        profile = None

    assert doc_service.display_name(_User()) == "Alice"
    assert doc_service.display_name(_UserNoProfile()) == "bob@example.com"


def test_day_start_and_end():
    dt = datetime(2026, 3, 15, 15, 30, 45, tzinfo=timezone.utc)
    start = doc_service._day_start(dt)
    end = doc_service._day_end(dt)
    assert start.hour == 0 and start.minute == 0
    assert end.hour == 23 and end.minute == 59 and end.microsecond == 999999


def test_apply_filter_rules_empty_returns_input():
    assert (
        doc_service.apply_filter_rules(
            MagicMock(), [], [], user_id=uuid.uuid4(), shared_ids=set(), recent={}
        )
        == []
    )

def test_word_count_and_doc_url():
    assert doc_service.word_count("<p>hello <strong>world</strong></p>") == 2
    assert doc_service.word_count("") == 0
    doc_id = uuid.uuid4()
    assert doc_service.doc_url(doc_id).endswith(f"/app/docs/{doc_id}")


def test_normalize_page_settings_defaults():
    out = doc_service.normalize_page_settings(None)
    assert out.subpages_view == "table"
    out2 = doc_service.normalize_page_settings({"subpages_view": "cards", "font_style": "serif"})
    assert out2.subpages_view == "cards"
    assert out2.font_style == "serif"


def test_parse_day_accepts_iso_and_date_only():
    parsed = doc_service._parse_day("2026-03-15T10:00:00Z")
    assert parsed is not None
    assert parsed.year == 2026
    assert doc_service._parse_day("2026-03-15") is not None
    assert doc_service._parse_day("not-a-date") is None


def test_match_date_operators():
    dt = datetime(2026, 3, 15, 15, 30, tzinfo=timezone.utc)
    assert doc_service._match_date(dt, "on", "2026-03-15")
    assert doc_service._match_date(dt, "before", "2026-03-16")
    assert doc_service._match_date(dt, "after", "2026-03-14")
    assert not doc_service._match_date(None, "on", "2026-03-15")


def test_sort_doc_list_by_viewed_at():
    now = datetime.now(timezone.utc)
    ws_id = uuid.uuid4()
    user_id = uuid.uuid4()
    id_a = uuid.uuid4()
    id_b = uuid.uuid4()
    docs = [
        Document(
            id=id_a,
            workspace_id=ws_id,
            title="B",
            content="",
            status="draft",
            created_by=user_id,
            updated_by=user_id,
        ),
        Document(
            id=id_b,
            workspace_id=ws_id,
            title="A",
            content="",
            status="draft",
            created_by=user_id,
            updated_by=user_id,
        ),
    ]
    recent = {id_b: now, id_a: now.replace(year=now.year - 1)}
    ordered = doc_service.sort_doc_list(docs, "viewed_at", "desc", recent)
    assert ordered[0].id == id_b
