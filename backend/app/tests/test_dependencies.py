"""Regression tests for issue #35 — pinned dependency minimums."""
from __future__ import annotations

import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
REQUIREMENTS = ROOT / "requirements.txt"

# (package, minimum (major, minor, patch))
SECURITY_PINS: list[tuple[str, tuple[int, int, int]]] = [
    ("cryptography", (44, 0, 1)),  # CVE-2024-12797
    ("requests", (2, 32, 4)),  # CVE-2024-47081
    ("starlette", (0, 47, 2)),  # CVE-2025-54121
    ("python-multipart", (0, 0, 31)),  # multipart upload GHSA set
    ("pyjwt", (2, 13, 0)),  # JWT advisories
]


def _parse_version(raw: str) -> tuple[int, int, int]:
    parts = raw.strip().split(".")
    nums = [int(p) for p in parts[:3]]
    while len(nums) < 3:
        nums.append(0)
    return nums[0], nums[1], nums[2]


def _pinned_versions() -> dict[str, str]:
    pins: dict[str, str] = {}
    for line in REQUIREMENTS.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#"):
            continue
        # strip extras e.g. uvicorn[standard]
        name = re.split(r"[\[=<>!]", line, maxsplit=1)[0].strip().lower()
        match = re.search(r"==\s*([0-9]+(?:\.[0-9]+)*)", line)
        if match:
            pins[name] = match.group(1)
    return pins


def test_requirements_file_exists():
    assert REQUIREMENTS.is_file()


def test_security_sensitive_packages_meet_minimum_pins():
    pins = _pinned_versions()
    for package, minimum in SECURITY_PINS:
        assert package in pins, f"{package} must be explicitly pinned in requirements.txt"
        assert _parse_version(pins[package]) >= minimum, (
            f"{package}=={pins[package]} is below minimum {minimum[0]}.{minimum[1]}.{minimum[2]}"
        )


def test_fastapi_declares_starlette_companion():
    """Starlette must be pinned explicitly (not only transitive via FastAPI)."""
    pins = _pinned_versions()
    assert "fastapi" in pins
    assert "starlette" in pins
