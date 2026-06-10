import os

from slowapi import Limiter
from slowapi.util import get_remote_address

# RATE_LIMIT_ENABLED=false disables limiting (used by the test suite)
_enabled = os.environ.get("RATE_LIMIT_ENABLED", "true").lower() not in ("0", "false", "no")

limiter = Limiter(key_func=get_remote_address, enabled=_enabled)
