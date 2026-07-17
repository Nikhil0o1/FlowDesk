"""Unit tests for migration repair helpers."""
from unittest.mock import MagicMock

import pytest

from scripts import ensure_migrations

pytestmark = pytest.mark.unit


def test_revision_exists_handles_missing_revision():
    script = MagicMock()
    script.get_revision.side_effect = KeyError("missing")
    assert ensure_migrations._revision_exists(script, "chatdmprefs01") is False


def test_orphan_stamp_target_maps_chatdmprefs01_to_known_revision():
    inspector = MagicMock()
    inspector.get_table_names.return_value = ["chat_members", "sprints"]
    inspector.get_columns.side_effect = lambda table: (
        [{"name": "closed_at"}, {"name": "is_favorite"}]
        if table == "chat_members"
        else []
    )

    script = MagicMock()
    script.get_revision.return_value = object()
    ensure_migrations._script_directory = lambda: script  # type: ignore[method-assign]

    assert ensure_migrations._orphan_stamp_target("chatdmprefs01", inspector) == "chatdmprefs01"


def test_orphan_stamp_target_maps_removed_c7mergeheads_to_chatattach():
    inspector = MagicMock()
    inspector.get_table_names.return_value = ["chat_members"]
    inspector.get_columns.return_value = []

    assert ensure_migrations._orphan_stamp_target("c7mergeheads", inspector) == "chatattach01"
