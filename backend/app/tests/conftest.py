"""Test fixtures: isolated 'flowdesk_test' database with full schema per session."""
import os

# Must be set before app modules are imported (settings/limiter read env at import time)
os.environ.setdefault("SCHEDULER_ENABLED", "false")
os.environ.setdefault("EMAIL_ENABLED", "false")
os.environ.setdefault("RATE_LIMIT_ENABLED", "false")

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, text
from sqlalchemy.orm import sessionmaker

from app.core.config import settings
from app.core.security import hash_password
from app.db.base import Base
from app.db.session import get_db
from app.main import app
from app.models.organization import Organization, OrganizationMember
from app.models.user import Profile, User

TEST_DB_NAME = "flowdesk_test"


def _test_db_url() -> str:
    base, _, _ = settings.DATABASE_URL.rpartition("/")
    return f"{base}/{TEST_DB_NAME}"


@pytest.fixture(scope="session")
def engine():
    admin_engine = create_engine(settings.DATABASE_URL, isolation_level="AUTOCOMMIT")
    with admin_engine.connect() as conn:
        exists = conn.execute(
            text("SELECT 1 FROM pg_database WHERE datname = :name"), {"name": TEST_DB_NAME}
        ).scalar()
        if not exists:
            conn.execute(text(f'CREATE DATABASE "{TEST_DB_NAME}"'))
    test_engine = create_engine(_test_db_url())
    Base.metadata.drop_all(test_engine)
    Base.metadata.create_all(test_engine)
    yield test_engine
    test_engine.dispose()


@pytest.fixture()
def db(engine):
    connection = engine.connect()
    transaction = connection.begin()
    TestSession = sessionmaker(bind=connection, expire_on_commit=False)
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
    organization = Organization(name="Test Org", slug="test-org")
    db.add(organization)
    db.flush()
    return organization


def make_user(db, email: str, password: str = "Password123!", superadmin: bool = False) -> User:
    user = User(
        email=email,
        hashed_password=hash_password(password),
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


def auth_headers(client: TestClient, email: str, password: str = "Password123!") -> dict:
    response = client.post("/api/v1/auth/login", json={"email": email, "password": password})
    assert response.status_code == 200, response.text
    return {"Authorization": f"Bearer {response.json()['access_token']}"}
