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


class StorageBackend(ABC):
    @abstractmethod
    def save(self, key: str, content: bytes) -> None: ...

    @abstractmethod
    def read(self, key: str) -> bytes: ...

    @abstractmethod
    def delete(self, key: str) -> None: ...


class LocalStorage(StorageBackend):
    def __init__(self, base_dir: str):
        self.base = Path(base_dir).resolve()
        self.base.mkdir(parents=True, exist_ok=True)

    def _path(self, key: str) -> Path:
        path = (self.base / key).resolve()
        if not str(path).startswith(str(self.base)):
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
    mime = file.content_type or "application/octet-stream"
    if not (mime.startswith(ALLOWED_MIME_PREFIXES) or mime in ALLOWED_MIME_EXACT):
        raise HTTPException(status_code=400, detail=f"Content type {mime} is not allowed")


def build_key(task_id: uuid.UUID, filename: str) -> str:
    safe_name = os.path.basename(filename or "file").replace("\\", "_")[:200]
    return f"tasks/{task_id}/{uuid.uuid4().hex}_{safe_name}"
