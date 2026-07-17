"""Phase 2 unit tests — JSON payload limits."""
import pytest

from app.core.json_limits import JsonPayloadTooDeep, JsonPayloadTooLarge, validate_json_payload


@pytest.mark.unit
def test_json_payload_accepts_valid_object():
    validate_json_payload({"a": 1, "b": [1, 2]}, max_bytes=500, max_depth=5)


@pytest.mark.unit
def test_json_payload_rejects_oversize():
    with pytest.raises(JsonPayloadTooLarge):
        validate_json_payload({"x": "y" * 5000}, max_bytes=100, max_depth=5)


@pytest.mark.unit
def test_json_payload_rejects_excessive_depth():
    nested = {"l1": {"l2": {"l3": {"l4": 1}}}}
    with pytest.raises(JsonPayloadTooDeep):
        validate_json_payload(nested, max_bytes=10_000, max_depth=3)
