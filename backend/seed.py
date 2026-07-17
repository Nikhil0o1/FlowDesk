"""Seed the platform superadmin for FlowDesk.

Usage:  python seed.py

Idempotent: creates the superadmin once from SUPERADMIN_EMAIL (default
brightcone.system@gmail.com). Re-running only syncs is_platform_superadmin
and is_active — no demo orgs, workspaces, or other data are inserted.

Sign in via email OTP or SSO — no passwords.
"""
from datetime import datetime, timezone

from sqlalchemy import select

from app.core.config import settings
from app.db.base import Base  # noqa: F401  (registers all models)
from app.db.session import SessionLocal
from app.models.user import Profile, User

SUPERADMIN_NAME = "Bright Cone System"
SUPERADMIN_TITLE = "Platform Administrator"


def ensure_superadmin(db, email: str, name: str, title: str) -> User:
    """Create the platform superadmin once; sign in via email OTP."""
    user = db.scalar(select(User).where(User.email == email))
    if user:
        user.is_platform_superadmin = True
        user.is_active = True
        if user.profile is None:
            db.add(Profile(user_id=user.id, full_name=name, title=title, timezone="UTC"))
        return user

    now = datetime.now(timezone.utc)
    user = User(
        email=email,
        is_active=True,
        is_platform_superadmin=True,
        email_verified_at=now,
        auth_provider="otp",
    )
    db.add(user)
    db.flush()
    db.add(Profile(user_id=user.id, full_name=name, title=title, timezone="UTC"))
    return user


def main() -> None:
    db = SessionLocal()
    try:
        ensure_superadmin(db, settings.SUPERADMIN_EMAIL, SUPERADMIN_NAME, SUPERADMIN_TITLE)
        db.commit()
        print(f"Superadmin ready: {settings.SUPERADMIN_EMAIL}")
    finally:
        db.close()


if __name__ == "__main__":
    main()
