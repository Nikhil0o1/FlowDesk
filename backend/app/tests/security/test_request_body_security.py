"""Phase 4 security — oversized request bodies rejected at the API edge."""
import pytest

from app.core.config import settings


@pytest.mark.security
def test_api_rejects_oversized_content_length(client):
    over = settings.max_request_body_bytes + 1
    response = client.post(
        "/api/v1/auth/otp/request",
        content=b'{"email":"x@test.dev"}',
        headers={"Content-Length": str(over), "Content-Type": "application/json"},
    )
    assert response.status_code == 413
    assert "limit" in response.json()["detail"].lower()
