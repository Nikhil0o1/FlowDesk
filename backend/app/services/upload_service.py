"""Bounded upload reads — stream to memory with a running size guard (issue #10)."""
from __future__ import annotations

from fastapi import HTTPException, Request, UploadFile

from app.core.config import settings

_UPLOAD_CHUNK_SIZE = 64 * 1024  # 64 KiB


def max_attachment_bytes() -> int:
    return settings.MAX_UPLOAD_SIZE_MB * 1024 * 1024


def max_avatar_bytes() -> int:
    return settings.MAX_AVATAR_SIZE_MB * 1024 * 1024


def max_avatar_request_bytes() -> int:
    return max_avatar_bytes() + settings.upload_multipart_overhead_bytes


async def read_bounded_upload(file: UploadFile, max_bytes: int) -> bytes:
    """Read an UploadFile in chunks; abort before exceeding max_bytes."""
    chunks: list[bytes] = []
    total = 0
    try:
        while True:
            chunk = await file.read(_UPLOAD_CHUNK_SIZE)
            if not chunk:
                break
            total += len(chunk)
            if total > max_bytes:
                raise HTTPException(
                    status_code=413,
                    detail=f"File exceeds the {max_bytes // (1024 * 1024)}MB limit",
                )
            chunks.append(chunk)
    finally:
        await file.close()

    content = b"".join(chunks)
    if not content:
        raise HTTPException(status_code=400, detail="Empty file")
    return content


def guard_upload_request(request: Request, max_bytes: int) -> None:
    """Reject oversize uploads when Content-Length is advertised."""
    from app.core.request_body_limit import reject_content_length

    reject_content_length(request, max_bytes)
