"""Phase 2 unit tests — storage and upload validation."""
from io import BytesIO
from unittest.mock import MagicMock, patch

import pytest
from fastapi import HTTPException, UploadFile

from app.services import storage_service as ss
from app.services.storage_service import LocalStorage, build_key, safe_download_media_type, validate_upload


@pytest.mark.unit
def test_build_key_sanitizes_filename():
    import uuid

    tid = uuid.uuid4()
    key = build_key(tid, "../../etc/passwd")
    assert ".." not in key
    assert key.startswith(f"tasks/{tid}/")


@pytest.mark.unit
def test_local_storage_path_containment(tmp_path):
    base = tmp_path / "uploads"
    storage = LocalStorage(str(base))
    storage.save("nested/file.txt", b"data")
    with pytest.raises(HTTPException):
        storage.read("../outside.txt")


@pytest.mark.unit
def test_validate_upload_rejects_blocked_extension():
    file = UploadFile(filename="script.exe", file=BytesIO(b"MZ\x90\x00" + b"\x00" * 64))
    with pytest.raises(HTTPException) as exc:
        validate_upload(file, b"MZ\x90\x00" + b"\x00" * 64)
    assert exc.value.status_code == 400


@pytest.mark.unit
def test_validate_upload_accepts_pdf():
    content = b"%PDF-1.4\nhello"
    file = UploadFile(filename="doc.pdf", file=BytesIO(content))
    validate_upload(file, content)


@pytest.mark.unit
def test_safe_download_media_type_prefers_sniffed_pdf():
    content = b"%PDF-1.4"
    media = safe_download_media_type("doc.pdf", "application/octet-stream", content)
    assert media == "application/pdf"


@pytest.mark.unit
@pytest.mark.parametrize(
    "content,expected",
    [
        (b"%PDF-1.4", "application/pdf"),
        (b"\x89PNG\r\n\x1a\n" + b"\x00" * 8, "image/png"),
        (b"\xff\xd8\xff\xe0", "image/jpeg"),
        (b"GIF89a", "image/gif"),
        (b"PK\x03\x04", "application/zip"),
        (b"RIFF" + b"\x00" * 4 + b"WEBP" + b"\x00" * 4, "image/webp"),
        (b"MZ\x90", "application/x-msdownload"),
        (b"\x7fELF", "application/x-executable"),
        (b"<html><body>", "text/html"),
    ],
)
def test_sniff_mime(content, expected):
    assert ss._sniff_mime(content) == expected


@pytest.mark.unit
def test_validate_upload_empty_and_oversize(monkeypatch):
    monkeypatch.setattr("app.services.storage_service.settings.MAX_UPLOAD_SIZE_MB", 1)
    empty = UploadFile(filename="a.txt", file=BytesIO(b""))
    with pytest.raises(HTTPException) as exc:
        ss.validate_upload(empty, b"")
    assert exc.value.status_code == 400

    big = UploadFile(filename="big.bin", file=BytesIO(b"x" * (2 * 1024 * 1024)))
    with pytest.raises(HTTPException) as exc:
        ss.validate_upload(big, b"x" * (2 * 1024 * 1024))
    assert exc.value.status_code == 413


@pytest.mark.unit
def test_validate_upload_accepts_any_non_executable_format():
    # Arbitrary/unknown formats (archives, fonts, binary dumps…) are all accepted.
    for name, mime, content in [
        ("archive.7z", "application/x-7z-compressed", b"7z\xbc\xaf\x27\x1c" + b"\x00" * 16),
        ("data.rar", "application/vnd.rar", b"Rar!\x1a\x07" + b"\x00" * 16),
        ("dump.bin", "application/octet-stream", b"\x00\x01\x02\x03" * 8),
        ("font.woff2", "font/woff2", b"wOF2" + b"\x00" * 16),
    ]:
        file = UploadFile(filename=name, file=BytesIO(content), headers={"content-type": mime})
        ss.validate_upload(file, content)


@pytest.mark.unit
def test_validate_upload_rejects_executable_content_regardless_of_name():
    # An .exe renamed to .pdf is still caught by content sniffing.
    content = b"MZ\x90\x00" + b"\x00" * 64
    file = UploadFile(filename="doc.pdf", file=BytesIO(content), headers={"content-type": "application/pdf"})
    with pytest.raises(HTTPException) as exc:
        ss.validate_upload(file, content)
    assert exc.value.status_code == 400


@pytest.mark.unit
def test_safe_download_blocked_and_disallowed():
    exe = b"MZ" + b"\x90" * 10
    assert ss.safe_download_media_type("x.exe", "application/octet-stream", exe) == "application/octet-stream"
    assert ss.safe_download_media_type("x.bin", "application/x-evil", b"data") == "application/octet-stream"


@pytest.mark.unit
def test_local_storage_round_trip_and_missing(tmp_path):
    storage = ss.LocalStorage(str(tmp_path / "uploads"))
    storage.save("a/b.txt", b"hello")
    assert storage.read("a/b.txt") == b"hello"
    storage.delete("a/b.txt")
    with pytest.raises(HTTPException):
        storage.read("a/b.txt")
    assert storage.presigned_url("a/b.txt") is None


@pytest.mark.unit
def test_s3_storage_operations(monkeypatch):
    fake_boto3 = MagicMock()
    monkeypatch.setitem(__import__("sys").modules, "boto3", fake_boto3)
    monkeypatch.setattr("app.services.storage_service.settings.S3_BUCKET", "test-bucket")
    client = MagicMock()
    fake_boto3.client.return_value = client
    client.exceptions.NoSuchKey = type("NoSuchKey", (Exception,), {})
    client.get_object.return_value = {"Body": MagicMock(read=lambda: b"s3-data")}

    storage = ss.S3Storage()
    storage.save("key", b"bytes")
    assert storage.read("key") == b"s3-data"
    storage.delete("key")
    assert storage.presigned_url("key", expires_in=60)

    client.get_object.side_effect = client.exceptions.NoSuchKey()
    with pytest.raises(HTTPException):
        storage.read("missing")


@pytest.mark.unit
def test_get_storage_singleton(monkeypatch, tmp_path):
    ss._storage = None
    monkeypatch.setattr("app.services.storage_service.settings.STORAGE_BACKEND", "local")
    monkeypatch.setattr("app.services.storage_service.settings.UPLOAD_DIR", str(tmp_path))
    assert isinstance(ss.get_storage(), ss.LocalStorage)
    assert ss.get_storage() is ss.get_storage()
