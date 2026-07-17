"""Stable task reference strings derived from project UUID + task number."""
import re
import uuid

TASK_REF_RE = re.compile(r"\b([A-F0-9]{8})-(\d+)\b")
STATUS_TAG_RE = re.compile(r"\b([A-F0-9]{8})-(\d+)\s*\[([^\[\]\n]{1,40})\]")


def project_ref_prefix(project_id: uuid.UUID) -> str:
    return project_id.hex[:8].upper()


def format_task_ref(project_id: uuid.UUID, task_number: int) -> str:
    return f"{project_ref_prefix(project_id)}-{task_number}"
