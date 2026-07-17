"""Defenses against spreadsheet formula injection (issue #15)."""
from __future__ import annotations

_FORMULA_PREFIXES = ("=", "+", "-", "@", "\t", "\r")


def sanitize_sheet_cell(value) -> str | int | float | None:
    """Neutralise values that spreadsheets may interpret as formulas."""
    if value is None:
        return None
    if isinstance(value, (int, float)):
        return value
    text = str(value)
    if text and text[0] in _FORMULA_PREFIXES:
        return "'" + text
    return text


def sanitize_sheet_rows(rows: list[list]) -> list[list]:
    return [[sanitize_sheet_cell(cell) for cell in row] for row in rows]
