import re
from typing import Annotated, Final

from pydantic import AfterValidator

INVITE_EMAIL_PATTERN = re.compile(
    r"^(?=.{1,254}$)(?=.{1,64}@)"
    r"([A-Za-z0-9]+(?:[._%+-][A-Za-z0-9]+)*)"
    r"@(?:[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?\.)+[A-Za-z]{2,63}$"
)
INVITE_EMAIL_ERROR = "Please enter a valid email address"

# Typosquats like gmailkkdsfm.com / outlookjhvkjv.in — extra chars glued after the brand name.
_PROVIDER_TYPO_RE = re.compile(
    r"^(gmail|googlemail|outlook|hotmail|live|msn)[a-z0-9]+$", re.IGNORECASE
)

GMAIL_DOMAINS: Final[frozenset[str]] = frozenset({"gmail.com", "googlemail.com"})

# Microsoft consumer mail — includes country / regional TLDs (outlook.in, hotmail.co.uk, …).
MICROSOFT_DOMAINS: Final[frozenset[str]] = frozenset(
    {
        "outlook.com",
        "outlook.in",
        "outlook.co.in",
        "outlook.co.uk",
        "outlook.de",
        "outlook.fr",
        "outlook.es",
        "outlook.it",
        "outlook.jp",
        "outlook.com.au",
        "outlook.sg",
        "outlook.hk",
        "hotmail.com",
        "hotmail.co.uk",
        "hotmail.fr",
        "hotmail.de",
        "hotmail.it",
        "hotmail.es",
        "hotmail.in",
        "hotmail.co.in",
        "hotmail.com.br",
        "live.com",
        "live.co.uk",
        "live.in",
        "live.fr",
        "live.nl",
        "live.com.au",
        "live.ca",
        "msn.com",
    }
)

_PROVIDER_DOMAINS: Final[dict[str, frozenset[str]]] = {
    "gmail": GMAIL_DOMAINS,
    "googlemail": GMAIL_DOMAINS,
    "outlook": MICROSOFT_DOMAINS,
    "hotmail": MICROSOFT_DOMAINS,
    "live": MICROSOFT_DOMAINS,
    "msn": MICROSOFT_DOMAINS,
}


def _provider_domain_allowed(domain: str) -> bool:
    normalized = domain.lower()
    label = normalized.split(".", 1)[0]

    if _PROVIDER_TYPO_RE.match(label):
        return False

    allowed = _PROVIDER_DOMAINS.get(label)
    if allowed is not None:
        return normalized in allowed

    return True


def normalize_invite_email(value: str) -> str:
    normalized = value.strip().lower()
    if not INVITE_EMAIL_PATTERN.match(normalized):
        raise ValueError(INVITE_EMAIL_ERROR)
    domain = normalized.split("@", 1)[1]
    if not _provider_domain_allowed(domain):
        raise ValueError(INVITE_EMAIL_ERROR)
    return normalized


InviteEmail = Annotated[str, AfterValidator(normalize_invite_email)]
