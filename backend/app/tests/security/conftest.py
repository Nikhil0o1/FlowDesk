"""Phase 4 fixtures — opt-in rate limiting for security tests."""
import pytest

from app.core.rate_limit import limiter


@pytest.fixture()
def rate_limits_on():
    """Enable slowapi limiting for the duration of a test (disabled globally in conftest)."""
    previous = limiter.enabled
    limiter.enabled = True
    limiter.reset()
    yield
    limiter.enabled = previous
    limiter.reset()
