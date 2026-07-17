"""Test fixtures: isolated 'flowdesk_test' database with full schema per session."""
import os

# Must be set before app modules are imported (settings/limiter read env at import time).
# Use assignment (not setdefault) so shell/.env dev values cannot leak into the test run.
os.environ["ENVIRONMENT"] = "test"
os.environ["DEBUG"] = "false"
os.environ["SECRET_KEY"] = "test-secret-key-not-for-production"
os.environ["FRONTEND_URL"] = "http://localhost:5173"
os.environ["BACKEND_URL"] = "http://localhost:8000"
# DATABASE_URL must come from flowdesk_API/.env (pydantic-settings).
os.environ["MICROSOFT_TENANT"] = "common"
os.environ["SCHEDULER_ENABLED"] = "false"
os.environ["CELERY_ENABLED"] = "true"
os.environ["REDIS_URL"] = ""
os.environ["CELERY_TASK_ALWAYS_EAGER"] = "true"
os.environ["RATE_LIMIT_ENABLED"] = "false"
os.environ["TRUSTED_HOSTS"] = "testserver,localhost,127.0.0.1"
os.environ["API_KEY_PEPPERS"] = '{"1":"test-pat-pepper-do-not-use-in-prod"}'
os.environ["API_KEY_PEPPER_CURRENT"] = "1"

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, text
from sqlalchemy.orm import sessionmaker

from app.core.api_key_digest import clear_pepper_cache
from app.core.config import get_settings

get_settings.cache_clear()
clear_pepper_cache()
settings = get_settings()
from app.db.base import Base
from app.db.session import get_db
from app.main import app
from app.models.organization import Organization, OrganizationMember
from app.models.user import Profile, User

TEST_DB_NAME = "flowdesk_test"


def _test_db_url() -> str:
    base, _, _ = settings.DATABASE_URL.rpartition("/")
    return f"{base}/{TEST_DB_NAME}"


def _terminate_test_db_sessions(conn) -> None:
    """Drop stale pytest sessions that block DROP SCHEMA (e.g. after Ctrl+C)."""
    conn.execute(
        text(
            "SELECT pg_terminate_backend(pid) FROM pg_stat_activity "
            "WHERE datname = :dbname AND pid <> pg_backend_pid()"
        ),
        {"dbname": TEST_DB_NAME},
    )


@pytest.fixture(scope="session")
def engine():
    admin_engine = create_engine(settings.DATABASE_URL, isolation_level="AUTOCOMMIT")
    with admin_engine.connect() as conn:
        exists = conn.execute(
            text("SELECT 1 FROM pg_database WHERE datname = :name"), {"name": TEST_DB_NAME}
        ).scalar()
        if not exists:
            conn.execute(text(f'CREATE DATABASE "{TEST_DB_NAME}"'))
        _terminate_test_db_sessions(conn)
    test_engine = create_engine(_test_db_url())
    with test_engine.begin() as conn:
        conn.execute(text("DROP SCHEMA public CASCADE"))
        conn.execute(text("CREATE SCHEMA public"))
    Base.metadata.create_all(test_engine)
    yield test_engine
    test_engine.dispose()


@pytest.fixture()
def db(engine):
    connection = engine.connect()
    transaction = connection.begin()
    # autoflush=False matches production (app/db/session.py); with autoflush on,
    # tests miss stale-read bugs that only occur under prod session semantics.
    TestSession = sessionmaker(bind=connection, autoflush=False, expire_on_commit=False)
    session = TestSession()
    # Allow code under test to call commit without ending our outer transaction
    session.begin_nested()

    from sqlalchemy import event

    @event.listens_for(session, "after_transaction_end")
    def restart_savepoint(sess, trans):
        if trans.nested and not trans._parent.nested:
            sess.begin_nested()

    yield session
    session.close()
    transaction.rollback()
    connection.close()


@pytest.fixture()
def client(db):
    app.dependency_overrides[get_db] = lambda: db
    with TestClient(app) as test_client:
        yield test_client
    app.dependency_overrides.clear()


@pytest.fixture()
def org(db):
    organization = Organization(name="Test Org")
    db.add(organization)
    db.flush()
    return organization


def make_user(db, email: str, superadmin: bool = False) -> User:
    user = User(
        email=email,
        is_active=True,
        is_platform_superadmin=superadmin,
    )
    db.add(user)
    db.flush()
    db.add(Profile(user_id=user.id, full_name=email.split("@")[0].title()))
    db.flush()
    return user


@pytest.fixture()
def owner(db, org):
    user = make_user(db, "owner@test.dev")
    db.add(OrganizationMember(organization_id=org.id, user_id=user.id, role="owner"))
    db.flush()
    return user


@pytest.fixture()
def superadmin(db):
    return make_user(db, "super@test.dev", superadmin=True)


def auth_headers(client: TestClient, email: str, password: str | None = None) -> dict:
    """Authenticate a test user. Login is passwordless (SSO / email code) now, so
    instead of hitting an endpoint we mint a stateless access token directly for
    the user via the same test DB session the client uses."""
    from sqlalchemy import select

    from app.core.security import create_access_token
    from app.db.session import get_db
    from app.main import app
    from app.models.user import User

    db = app.dependency_overrides[get_db]()
    user = db.scalar(select(User).where(User.email == email))
    assert user is not None, f"test user {email} does not exist"
    token = create_access_token(user.id, user.is_platform_superadmin)
    return {"Authorization": f"Bearer {token}"}


def seed_login_otp(db, email: str, code: str = "123456"):
    """Insert a known email sign-in code so tests can drive the OTP verify flow."""
    from datetime import datetime, timedelta, timezone

    from app.core.security import hash_token
    from app.models.user import LoginOtp

    otp = LoginOtp(
        email=email,
        code_hash=hash_token(code),
        expires_at=datetime.now(timezone.utc) + timedelta(minutes=10),
    )
    db.add(otp)
    db.flush()
    return otp


def seed_totp(db, user, secret: str | None = None) -> str:
    """Enroll a user in TOTP 2FA (enabled). Returns the base32 secret."""
    from datetime import datetime, timezone

    import pyotp

    from app.core.security import encrypt_secret

    if secret is None:
        secret = pyotp.random_base32()
    user.totp_secret_enc = encrypt_secret(secret)
    user.totp_enabled = True
    user.totp_confirmed_at = datetime.now(timezone.utc)
    db.flush()
    return secret


def totp_now(secret: str) -> str:
    """Current valid 6-digit TOTP code for a base32 secret."""
    import pyotp

    return pyotp.TOTP(secret).now()


@pytest.fixture(autouse=True)
def _stub_github_verify_token_in_github_tests(request):
    """Seeded GitHub OAuth tokens are not real — treat as valid in GitHub integration tests."""
    from unittest.mock import patch

    mod = getattr(request.node, "module", None)
    mod_name = getattr(mod, "__name__", "") or ""
    if not mod_name.startswith("app.tests.integration.test_github"):
        yield
        return
    with patch("app.api.v1.github.github_api_service.verify_token", return_value=True):
        yield
