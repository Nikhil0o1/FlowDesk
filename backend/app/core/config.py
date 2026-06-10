from functools import lru_cache
from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict

# Single .env at the repository root (d:\FLowDesk\.env), shared by backend and frontend
ROOT_ENV = Path(__file__).resolve().parents[3] / ".env"


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=(str(ROOT_ENV), ".env"), env_file_encoding="utf-8", extra="ignore"
    )

    # App
    APP_NAME: str = "FlowDesk"
    ENVIRONMENT: str = "development"
    DEBUG: bool = True
    SECRET_KEY: str = "dev-secret-key-do-not-use-in-production"
    FRONTEND_URL: str = "http://localhost:5173"
    BACKEND_URL: str = "http://localhost:8000"

    # Database
    DATABASE_URL: str = "postgresql+psycopg2://flowdesk:flowdesk@localhost:5432/flowdesk"

    # Auth
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 30
    REFRESH_TOKEN_EXPIRE_DAYS: int = 14
    INVITE_TOKEN_EXPIRE_HOURS: int = 48
    PASSWORD_RESET_TOKEN_EXPIRE_MINUTES: int = 60
    JWT_ALGORITHM: str = "HS256"

    # Google SSO + Calendar (same OAuth client)
    GOOGLE_CLIENT_ID: str = ""
    GOOGLE_CLIENT_SECRET: str = ""

    # SMTP
    SMTP_HOST: str = "localhost"
    SMTP_PORT: int = 1025
    SMTP_USER: str = ""
    SMTP_PASSWORD: str = ""
    SMTP_USE_TLS: bool = False
    EMAIL_FROM: str = "FlowDesk <no-reply@flowdesk.local>"
    EMAIL_ENABLED: bool = True

    # Storage
    STORAGE_BACKEND: str = "local"  # local | s3
    UPLOAD_DIR: str = "./uploads"
    MAX_UPLOAD_SIZE_MB: int = 20
    S3_BUCKET: str = ""
    S3_REGION: str = ""
    S3_ENDPOINT_URL: str = ""
    S3_ACCESS_KEY_ID: str = ""
    S3_SECRET_ACCESS_KEY: str = ""

    # GitHub
    GITHUB_WEBHOOK_SECRET: str = ""
    GITHUB_APP_ID: str = ""
    GITHUB_APP_PRIVATE_KEY: str = ""

    # Jobs
    ABANDONED_TIMER_MAX_HOURS: int = 8
    SCHEDULER_ENABLED: bool = True

    # Superadmin bootstrap
    SUPERADMIN_EMAIL: str = "admin@flowdesk.dev"
    SUPERADMIN_PASSWORD: str = "SuperAdmin123!"

    @property
    def cors_origins(self) -> list[str]:
        return [self.FRONTEND_URL]


@lru_cache
def get_settings() -> Settings:
    return Settings()


settings = get_settings()
