"""Regression tests for issue #36 backend hardening backlog."""
import pytest

from app.core.email_safety import sanitize_email_address, sanitize_email_subject
from app.core.json_limits import JsonPayloadTooDeep, JsonPayloadTooLarge, validate_json_payload
from app.services.storage_service import LocalStorage, _sniff_mime, validate_upload
from fastapi import UploadFile
from io import BytesIO


def test_json_payload_size_and_depth_limits():
    validate_json_payload({"a": 1}, max_bytes=100, max_depth=3)
    with pytest.raises(JsonPayloadTooLarge):
        validate_json_payload({"x": "y" * 10_000}, max_bytes=100, max_depth=5)
    nested = {"l1": {"l2": {"l3": {"l4": 1}}}}
    with pytest.raises(JsonPayloadTooDeep):
        validate_json_payload(nested, max_bytes=10_000, max_depth=3)


def test_email_header_crlf_rejected():
    with pytest.raises(ValueError):
        sanitize_email_subject("Hello\r\nBcc: evil@x.com")
    with pytest.raises(ValueError):
        sanitize_email_address("user@test.com\nCc: evil@x.com")


def test_local_storage_path_containment(tmp_path):
    base = tmp_path / "uploads"
    storage = LocalStorage(str(base))
    storage.save("ok/file.txt", b"hi")
    with pytest.raises(Exception):
        storage.read("../secret.txt")


def test_upload_sniff_rejects_executable_content():
    file = UploadFile(filename="evil.exe", file=BytesIO(b"MZ\x90\x00"))
    with pytest.raises(Exception):
        validate_upload(file, b"MZ\x90\x00" + b"\x00" * 64)


def test_sniff_detects_pdf():
    assert _sniff_mime(b"%PDF-1.4") == "application/pdf"
