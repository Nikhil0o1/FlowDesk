"""File storage abstraction: local disk for dev, S3-compatible for production."""
import os
import uuid
from abc import ABC, abstractmethod
from pathlib import Path

from fastapi import HTTPException, UploadFile

from app.core.config import settings

ALLOWED_MIME_PREFIXES = (
    "image/", "video/", "audio/", "text/",
)
ALLOWED_MIME_EXACT = {
    "application/pdf", "application/zip", "application/json", "application/xml",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    "application/msword", "application/vnd.ms-excel", "application/vnd.ms-powerpoint",
    "application/octet-stream", "text/csv",
}
BLOCKED_EXTENSIONS = {".exe", ".bat", ".cmd", ".sh", ".ps1", ".msi", ".dll", ".com", ".scr", ".js", ".vbs"}
BLOCKED_SNIFFED_MIMES = {
    "application/x-msdownload",
    "application/x-executable",
    "application/x-dosexec",
    "application/javascript",
    "text/javascript",
    "application/x-sh",
}


def _sniff_mime(content: bytes) -> str | None:
    """Lightweight magic-byte detection (no extra dependencies)."""
    if not content:
        return None
    if content.startswith(b"%PDF"):
        return "application/pdf"
    if content.startswith(b"\x89PNG\r\n\x1a\n"):
        return "image/png"
    if content[:3] == b"\xff\xd8\xff":
        return "image/jpeg"
    if content[:6] in (b"GIF87a", b"GIF89a"):
        return "image/gif"
    if content.startswith(b"PK\x03\x04"):
        return "application/zip"
    if content.startswith(b"RIFF") and len(content) > 12 and content[8:12] == b"WEBP":
        return "image/webp"
    if content.startswith(b"MZ"):
        return "application/x-msdownload"
    if content.startswith(b"\x7fELF"):
        return "application/x-executable"
    head = content[:512].lstrip().lower()
    if head.startswith((b"<html", b"<!doctype", b"<script")):
        return "text/html"
    return None


def _mime_allowed(mime: str) -> bool:
    return mime.startswith(ALLOWED_MIME_PREFIXES) or mime in ALLOWED_MIME_EXACT


def safe_download_media_type(file_name: str, stored_mime: str, content: bytes) -> str:
    """Prefer sniffed/trusted types over client-supplied content_type on download."""
    sniffed = _sniff_mime(content)
    if sniffed in BLOCKED_SNIFFED_MIMES:
        return "application/octet-stream"
    if sniffed and _mime_allowed(sniffed):
        return sniffed
    stored = (stored_mime or "application/octet-stream").split(";", 1)[0].strip().lower()
    if stored in BLOCKED_SNIFFED_MIMES or not _mime_allowed(stored):
        return "application/octet-stream"
    return stored


class StorageBackend(ABC):
    @abstractmethod
    def save(self, key: str, content: bytes) -> None: ...

    @abstractmethod
    def read(self, key: str) -> bytes: ...

    @abstractmethod
    def delete(self, key: str) -> None: ...

    @abstractmethod
    def presigned_url(self, key: str, expires_in: int = 900) -> str | None: ...


class LocalStorage(StorageBackend):
    def __init__(self, base_dir: str):
        self.base = Path(base_dir).resolve()
        self.base.mkdir(parents=True, exist_ok=True)

    def _path(self, key: str) -> Path:
        path = (self.base / key).resolve()
        # is_relative_to avoids sibling-prefix bypass (e.g. /uploads-evil)
        if not path.is_relative_to(self.base):
            raise HTTPException(status_code=400, detail="Invalid storage key")
        return path

    def save(self, key: str, content: bytes) -> None:
        path = self._path(key)
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(content)

    def read(self, key: str) -> bytes:
        path = self._path(key)
        if not path.exists():
            raise HTTPException(status_code=404, detail="File not found in storage")
        return path.read_bytes()

    def delete(self, key: str) -> None:
        path = self._path(key)
        if path.exists():
            path.unlink()

    def presigned_url(self, key: str, expires_in: int = 900) -> str | None:
        return None


class S3Storage(StorageBackend):
    """S3-compatible backend. Requires boto3 + S3_* env settings."""

    def __init__(self):
        try:
            import boto3  # noqa: PLC0415
        except ImportError as exc:
            raise RuntimeError("boto3 is required for STORAGE_BACKEND=s3 (pip install boto3)") from exc
        self.bucket = settings.S3_BUCKET
        self.client = boto3.client(
            "s3",
            region_name=settings.S3_REGION or None,
            endpoint_url=settings.S3_ENDPOINT_URL or None,
            aws_access_key_id=settings.S3_ACCESS_KEY_ID or None,
            aws_secret_access_key=settings.S3_SECRET_ACCESS_KEY or None,
        )

    def save(self, key: str, content: bytes) -> None:
        self.client.put_object(Bucket=self.bucket, Key=key, Body=content)

    def read(self, key: str) -> bytes:
        try:
            response = self.client.get_object(Bucket=self.bucket, Key=key)
        except self.client.exceptions.NoSuchKey:
            raise HTTPException(status_code=404, detail="File not found in storage")
        return response["Body"].read()

    def delete(self, key: str) -> None:
        self.client.delete_object(Bucket=self.bucket, Key=key)

    def presigned_url(self, key: str, expires_in: int = 900) -> str | None:
        return self.client.generate_presigned_url(
            "get_object",
            Params={"Bucket": self.bucket, "Key": key},
            ExpiresIn=expires_in,
        )


_storage: StorageBackend | None = None


def get_storage() -> StorageBackend:
    global _storage
    if _storage is None:
        if settings.STORAGE_BACKEND == "s3":
            _storage = S3Storage()
        else:
            _storage = LocalStorage(settings.UPLOAD_DIR)
    return _storage


def validate_upload(file: UploadFile, content: bytes) -> None:
    """Accept any file format except executables/scripts (blocklist, not allowlist).

    Storing arbitrary bytes is safe because downloads are always served with
    Content-Disposition: attachment + nosniff and a vetted media type
    (safe_download_media_type) — the browser never renders stored content
    in the app's origin.
    """
    max_bytes = settings.MAX_UPLOAD_SIZE_MB * 1024 * 1024
    if len(content) > max_bytes:
        raise HTTPException(
            status_code=413, detail=f"File exceeds the {settings.MAX_UPLOAD_SIZE_MB}MB limit"
        )
    if not content:
        raise HTTPException(status_code=400, detail="Empty file")
    ext = os.path.splitext(file.filename or "")[1].lower()
    if ext in BLOCKED_EXTENSIONS:
        raise HTTPException(status_code=400, detail=f"File type {ext} is not allowed")
    if _sniff_mime(content) in BLOCKED_SNIFFED_MIMES:
        raise HTTPException(status_code=400, detail="Executable or script files are not allowed")


def build_key(task_id: uuid.UUID, filename: str) -> str:
    safe_name = os.path.basename(filename or "file").replace("\\", "_")[:200]
    return f"tasks/{task_id}/{uuid.uuid4().hex}_{safe_name}"
