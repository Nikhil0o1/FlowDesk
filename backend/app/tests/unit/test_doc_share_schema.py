import uuid

import pytest
from pydantic import ValidationError

from app.schemas.document import ShareMemberCreate


@pytest.mark.unit
def test_share_member_create_requires_user_or_email():
    with pytest.raises(ValidationError):
        ShareMemberCreate(role="viewer")
    with pytest.raises(ValidationError):
        ShareMemberCreate(user_id=uuid.uuid4(), email="user@test.dev", role="viewer")


@pytest.mark.unit
def test_share_member_create_normalizes_email():
    body = ShareMemberCreate(email="User@Gmail.com", role="viewer")
    assert body.email == "user@gmail.com"


@pytest.mark.unit
def test_share_member_create_rejects_invalid_email():
    with pytest.raises(ValidationError):
        ShareMemberCreate(email="not-an-email", role="viewer")
