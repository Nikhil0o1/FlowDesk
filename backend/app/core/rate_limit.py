import os

from fastapi import Request
from slowapi import Limiter

# RATE_LIMIT_ENABLED=false disables limiting (used by the test suite)
_enabled = os.environ.get("RATE_LIMIT_ENABLED", "true").lower() not in ("0", "false", "no")


def trusted_client_ip(request: Request) -> str:
    """Rate-limit key from the socket peer — never trust client X-Forwarded-For."""
    if request.client:
        return request.client.host
    return "unknown"


def otp_request_rate_key(request: Request) -> str:
    return f"otp-request:{trusted_client_ip(request)}"


def otp_verify_rate_key(request: Request) -> str:
    return f"otp-verify:{trusted_client_ip(request)}"


def public_task_rate_key(request: Request) -> str:
    token = request.path_params.get("token")
    if token:
        return f"public-task:{token}"
    return trusted_client_ip(request)


def upload_rate_key(request: Request) -> str:
    return f"upload:{trusted_client_ip(request)}"


limiter = Limiter(key_func=trusted_client_ip, enabled=_enabled)

__all__ = [
    "limiter",
    "otp_request_rate_key",
    "otp_verify_rate_key",
    "public_task_rate_key",
    "upload_rate_key",
    "trusted_client_ip",
]
