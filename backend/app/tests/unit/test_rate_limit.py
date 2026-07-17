"""Phase 2 unit tests — rate limit key functions."""
import pytest
from starlette.requests import Request

from app.core.rate_limit import (
    otp_request_rate_key,
    otp_verify_rate_key,
    public_task_rate_key,
    trusted_client_ip,
    upload_rate_key,
)


def _request(path: str = "/", client_host: str = "203.0.113.10", **path_params) -> Request:
    scope = {
        "type": "http",
        "method": "GET",
        "path": path,
        "headers": [],
        "client": (client_host, 12345),
        "path_params": path_params,
    }
    return Request(scope)


@pytest.mark.unit
def test_trusted_client_ip_uses_socket_peer():
    assert trusted_client_ip(_request()) == "203.0.113.10"


@pytest.mark.unit
def test_otp_keys_include_operation():
    req = _request("/api/v1/auth/otp/request")
    assert otp_request_rate_key(req).startswith("otp-request:")
    assert otp_verify_rate_key(req).startswith("otp-verify:")


@pytest.mark.unit
def test_public_task_rate_key_uses_token():
    req = _request("/api/v1/public/tasks/abc123", token="abc123")
    assert public_task_rate_key(req) == "public-task:abc123"


@pytest.mark.unit
def test_upload_rate_key():
    req = _request("/api/v1/tasks/x/attachments")
    assert upload_rate_key(req).startswith("upload:")
