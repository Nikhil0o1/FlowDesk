from functools import lru_cache
from urllib.parse import urlparse

from pydantic import model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

APP_NAME = "FlowDesk"

CANONICAL_FRONTEND_URL = "https://flowdesk.brightcone.ai"
CANONICAL_BACKEND_URL = "https://flowdesk-api-mvwt.onrender.com"


def _url_hostname(url: str) -> str:
    try:
        return (urlparse(url.strip()).hostname or "").lower()
    except Exception:
        return ""


def _is_loopback_url(url: str) -> bool:
    return _url_hostname(url) in ("localhost", "127.0.0.1", "[::1]")


def _loopback_origin_aliases(url: str) -> list[str]:
    """localhost and 127.0.0.1 are different browser origins — include both in dev CORS."""
    parsed = urlparse(url)
    host = (parsed.hostname or "").lower()
    if host not in ("localhost", "127.0.0.1"):
        return []
    alt_host = "127.0.0.1" if host == "localhost" else "localhost"
    port = f":{parsed.port}" if parsed.port else ""
    scheme = parsed.scheme or "http"
    return [f"{scheme}://{alt_host}{port}"]

class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env", env_file_encoding="utf-8", extra="ignore"
    )

    # ── Zone 1: Required — no default, app won't start without these ──────────
    ENVIRONMENT: str
    DEBUG: bool
    SECRET_KEY: str
    FRONTEND_URL: str
    BACKEND_URL: str
    DATABASE_URL: str
    MICROSOFT_TENANT: str
    STORAGE_BACKEND: str

    # ── Zone 2: Optional integrations — empty = feature disabled ──────────────
    GOOGLE_CLIENT_ID: str = ""
    GOOGLE_CLIENT_SECRET: str = ""
    MICROSOFT_CLIENT_ID: str = ""

    EMAIL_FROM: str = ""
    EMAIL_SMTP_SERVER: str = "email-smtp.us-east-1.amazonaws.com"
    EMAIL_SMTP_PORT: int = 587
    EMAIL_USERNAME: str = ""
    EMAIL_PASSWORD: str = ""
    # When True, invite emails are sent through the inviter's connected Gmail, so they
    # arrive from that person's address. Default False: ALL email — invites included —
    # goes out via SMTP/SES from EMAIL_FROM (no-reply@brightcone.ai), one consistent sender.
    INVITE_EMAILS_VIA_USER_GMAIL: bool = False

    GITHUB_CLIENT_ID: str = ""
    GITHUB_CLIENT_SECRET: str = ""
    GITHUB_WEBHOOK_SECRET: str = ""

    # Public URL of the remote MCP HTTP server (Streamable HTTP). When empty, defaults to {BACKEND_URL}/mcp.
    MCP_PUBLIC_URL: str = ""
    # Run the Node MCP server in-process on the same VM (Render colocated mode).
    MCP_SIDECAR_ENABLED: bool = False
    MCP_SIDECAR_URL: str = "http://127.0.0.1:3100"

    STORAGE_BACKEND: str
    S3_BUCKET: str = ""
    S3_REGION: str = ""
    S3_ACCESS_KEY_ID: str = ""
    S3_SECRET_ACCESS_KEY: str = ""
    S3_ENDPOINT_URL: str = ""

    REDIS_URL: str = ""

    # PAT HMAC peppers — JSON map {"1":"secret",...}; CURRENT is used for new tokens.
    API_KEY_PEPPERS: str = ""
    API_KEY_PEPPER_CURRENT: int = 1
    PAT_ROTATION_GRACE_SECONDS: int = 300
    PAT_MAX_LIFETIME_DAYS: int = 365

    TRUSTED_HOSTS: str = ""
    # Comma-separated extra browser origins allowed by CORS (in addition to FRONTEND_URL).
    CORS_ORIGINS: str = ""
    TURNSTILE_SECRET_KEY: str = ""

    # ── Zone 3: Universal constants — same everywhere, no need in .env ────────
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 30
    REFRESH_TOKEN_EXPIRE_DAYS: int = 14
    INVITE_TOKEN_EXPIRE_HOURS: int = 48
    OTP_EXPIRE_MINUTES: int = 10
    OTP_MAX_ATTEMPTS: int = 5
    OTP_LOCKOUT_ATTEMPTS: int = 10
    OTP_LOCKOUT_MINUTES: int = 15
    JWT_ALGORITHM: str = "HS256"
    JWT_ISSUER: str = "flowdesk-api"
    JWT_AUDIENCE: str = "flowdesk-client"
    TWO_FACTOR_ISSUER: str = APP_NAME
    RECOVERY_CODE_COUNT: int = 10
    TWO_FACTOR_CHALLENGE_EXPIRE_MINUTES: int = 5

    UPLOAD_DIR: str = "./uploads"
    MAX_UPLOAD_SIZE_MB: int = 20
    MAX_AVATAR_SIZE_MB: int = 2
    UPLOAD_MULTIPART_OVERHEAD_MB: int = 4

    # Auto-stop running timers left open this long (30 days — allows multi-day tracking).
    ABANDONED_TIMER_MAX_HOURS: int = 720
    # Manual time entries may span multiple days (same ceiling as abandoned timers).
    MAX_MANUAL_ENTRY_HOURS: int = 720

    # Outbound webhooks
    WEBHOOK_ALLOW_PRIVATE_URLS: bool = False  # dev-only: allow localhost/private targets
    WEBHOOK_MAX_PER_ORG: int = 20
    WEBHOOK_DELIVERY_TIMEOUT_SECONDS: int = 10
    WEBHOOK_AUTO_DISABLE_THRESHOLD: int = 10
    WEBHOOK_DELIVERY_RETENTION_DAYS: int = 90
    WEBHOOK_SECRET_GRACE_SECONDS: int = 86400  # dual-sign with previous secret after rotate
    WEBHOOK_RECONCILE_STALE_MINUTES: int = 10
    WEBHOOK_API_VERSION: str = "2026-07-14"
    WEBHOOK_MAX_ATTEMPTS: int = 6  # initial + 5 Celery retries

    # WebSocket / realtime
    WS_TICKET_TTL_SECONDS: int = 60
    WS_MAX_CONNECTIONS_PER_USER: int = 10
    WS_MAX_CONNECTIONS_PER_TOKEN: int = 5
    WS_MAX_INTEGRATION_CONNECTIONS_PER_USER: int = 5
    WS_IDLE_TIMEOUT_SECONDS: int = 90  # close if no inbound message (incl. ping)
    WS_AUTH_MESSAGE_TIMEOUT_SECONDS: int = 10
    # When True, skip Origin checks (local scripts only). Production ignores this flag.
    WS_SKIP_ORIGIN_CHECK: bool = False

    REDIS_MAX_CONNECTIONS: int = 20
    CELERY_WORKER_CONCURRENCY: int = 4
    CELERY_TASK_TIME_LIMIT: int = 3600
    CELERY_TASK_SOFT_TIME_LIMIT: int = 3300
    CELERY_RESULT_EXPIRES: int = 86400
    CELERY_BEAT_SCHEDULE_FILE: str = "celerybeat-schedule"

    EMAIL_PRODUCT_NAME: str = APP_NAME
    EMAIL_LOGO_URL: str = ""
    # Address the outbound emails' support mailto link points to.
    SUPPORT_EMAIL: str = "support@brightcone.ai"

    SUPERADMIN_EMAIL: str = "brightcone.system@gmail.com"

    # ── Validators ────────────────────────────────────────────────────────────
    @model_validator(mode="after")
    def _production_guardrails(self) -> "Settings":
        if not self.is_production:
            return self
        if not self.SECRET_KEY.strip():
            raise ValueError("SECRET_KEY must be set in production")
        if self.DEBUG:
            raise ValueError("DEBUG must be false in production")
        if not self.GITHUB_WEBHOOK_SECRET.strip():
            raise RuntimeError("GITHUB_WEBHOOK_SECRET must be set in production")
        if self.uses_default_database_url:
            raise ValueError("DATABASE_URL must be explicitly set in production")
        self._validate_api_key_peppers(require=True)
        return self

    def _validate_api_key_peppers(self, *, require: bool) -> None:
        """Parse API_KEY_PEPPERS and ensure API_KEY_PEPPER_CURRENT maps to a secret."""
        from app.core.api_key_digest import parse_pepper_map

        raw = (self.API_KEY_PEPPERS or "").strip()
        if not raw:
            if require:
                raise ValueError("API_KEY_PEPPERS must be set in production")
            return
        try:
            pepper_map = parse_pepper_map(raw)
        except ValueError as exc:
            raise ValueError(f"API_KEY_PEPPERS is invalid: {exc}") from exc
        except Exception as exc:
            raise ValueError(
                "API_KEY_PEPPERS must be a JSON object mapping version strings to non-empty secrets "
                '(e.g. {"1":"<secret>"})'
            ) from exc
        if not pepper_map:
            raise ValueError("API_KEY_PEPPERS must contain at least one pepper version")
        current = int(self.API_KEY_PEPPER_CURRENT)
        if current not in pepper_map:
            raise ValueError(
                f"API_KEY_PEPPER_CURRENT={current} is not present in API_KEY_PEPPERS "
                f"(configured versions: {sorted(pepper_map)})"
            )
    # ── Derived properties ────────────────────────────────────────────────────
    @property
    def is_production(self) -> bool:
        return self.ENVIRONMENT.lower() == "production"

    @property
    def cors_origins(self) -> list[str]:
        origins: list[str] = []
        frontend = self.FRONTEND_URL.strip().rstrip("/")
        if frontend:
            origins.append(frontend)
        if self.CORS_ORIGINS.strip():
            origins.extend(
                origin.strip().rstrip("/")
                for origin in self.CORS_ORIGINS.split(",")
                if origin.strip()
            )
        if self.is_production:
            # Canonical production UI — always permitted even if FRONTEND_URL lags a deploy.
            origins.extend(
                [
                    "https://flowdesk.brightcone.ai",
                    "https://flowdesk-ui.onrender.com",
                ]
            )
        if not self.is_production:
            origins.extend(_loopback_origin_aliases(self.FRONTEND_URL))
        return list(dict.fromkeys(origins))

    @property
    def trusted_host_list(self) -> list[str]:
        hosts = [h.strip() for h in self.TRUSTED_HOSTS.split(",") if h.strip()]
        backend_host = urlparse(self.BACKEND_URL.strip()).hostname
        if backend_host and backend_host not in hosts:
            hosts.append(backend_host)
        # Colocated MCP sidecar calls the API on 127.0.0.1 (introspect, tool proxy).
        if self.MCP_SIDECAR_ENABLED:
            for loopback in ("127.0.0.1", "localhost"):
                if loopback not in hosts:
                    hosts.append(loopback)
        return hosts

    @property
    def redis_enabled(self) -> bool:
        return bool(self.REDIS_URL.strip())

    @property
    def celery_configured(self) -> bool:
        return bool(self.REDIS_URL.strip())

    @property
    def use_apscheduler(self) -> bool:
        return not self.redis_enabled

    @property
    def uses_default_database_url(self) -> bool:
        return self.DATABASE_URL == "postgresql+psycopg2://flowdesk:flowdesk@localhost:5432/flowdesk"

    @property
    def upload_multipart_overhead_bytes(self) -> int:
        return self.UPLOAD_MULTIPART_OVERHEAD_MB * 1024 * 1024

    @property
    def max_request_body_bytes(self) -> int:
        return (self.MAX_UPLOAD_SIZE_MB + self.UPLOAD_MULTIPART_OVERHEAD_MB) * 1024 * 1024

    @property
    def email_logo_url(self) -> str:
        if self.EMAIL_LOGO_URL.strip():
            return self.EMAIL_LOGO_URL.strip()
        return f"{self.FRONTEND_URL.rstrip('/')}/brightcone-logo.png"

    @property
    def support_email(self) -> str:
        return self.SUPPORT_EMAIL.strip()

    @property
    def mcp_sidecar_url(self) -> str:
        return (self.MCP_SIDECAR_URL or "http://127.0.0.1:3100").strip().rstrip("/")

    @property
    def public_backend_url(self) -> str:
        """Public API origin — never a loopback host in production."""
        raw = self.BACKEND_URL.strip().rstrip("/")
        if self.is_production and _is_loopback_url(raw):
            return CANONICAL_BACKEND_URL
        return raw

    @property
    def public_frontend_url(self) -> str:
        """Browser UI origin for OAuth consent and email links."""
        raw = self.FRONTEND_URL.strip().rstrip("/")
        if self.is_production and _is_loopback_url(raw):
            return CANONICAL_FRONTEND_URL
        return raw

    @property
    def mcp_public_url(self) -> str:
        """Remote MCP HTTP endpoint advertised to Cursor, Claude, and the settings UI."""
        override = (self.MCP_PUBLIC_URL or "").strip().rstrip("/")
        if override and not _is_loopback_url(override):
            base = override
        elif self.is_production or not _is_loopback_url(self.BACKEND_URL):
            base = self.public_backend_url
        else:
            base = "http://localhost:3100"
        normalized = base.rstrip("/")
        return normalized if normalized.endswith("/mcp") else f"{normalized}/mcp"

    @property
    def mcp_colocated_enabled(self) -> bool:
        """Run MCP on the same host as the API (proxy /mcp → Node sidecar)."""
        if self.MCP_SIDECAR_ENABLED:
            return True
        if not self.is_production:
            return False
        override = (self.MCP_PUBLIC_URL or "").strip().rstrip("/")
        # Loopback overrides are ignored by mcp_public_url in production, so treat
        # them as unset here too — otherwise /mcp would advertise but never mount.
        if not override or _is_loopback_url(override):
            return True
        backend = self.BACKEND_URL.strip().rstrip("/")
        public = self.public_backend_url
        return override in {backend, f"{backend}/mcp", public, f"{public}/mcp"}


@lru_cache
def get_settings() -> Settings:
    return Settings()


settings = get_settings()
