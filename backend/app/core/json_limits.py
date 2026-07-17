"""Bounds for user-supplied JSON payloads stored in JSONB columns."""
from __future__ import annotations

import json
from typing import Any


class JsonPayloadTooLarge(ValueError):
    pass


class JsonPayloadTooDeep(ValueError):
    pass


def _max_depth(value: Any, current: int = 0) -> int:
    if not isinstance(value, dict):
        if isinstance(value, list):
            if not value:
                return current
            return max(_max_depth(item, current + 1) for item in value)
        return current
    if not value:
        return current
    return max(_max_depth(child, current + 1) for child in value.values())


def validate_json_payload(
    value: dict | None,
    *,
    max_bytes: int,
    max_depth: int,
    label: str = "payload",
) -> dict | None:
    """Reject oversized or deeply nested JSON before persisting to JSONB."""
    if value is None:
        return None
    if not isinstance(value, dict):
        raise ValueError(f"{label} must be a JSON object")

    serialized = json.dumps(value, separators=(",", ":"), ensure_ascii=False)
    byte_len = len(serialized.encode("utf-8"))
    if byte_len > max_bytes:
        raise JsonPayloadTooLarge(
            f"{label} exceeds the {max_bytes // 1024}KB limit ({byte_len} bytes)"
        )

    depth = _max_depth(value)
    if depth > max_depth:
        raise JsonPayloadTooDeep(f"{label} exceeds maximum nesting depth of {max_depth}")

    return value
