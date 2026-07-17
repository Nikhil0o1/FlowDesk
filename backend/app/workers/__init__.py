"""Backward-compatible re-exports — prefer the top-level `workers` package.

Legacy entry point still works:

    python -m app.workers.scheduler
"""
from workers import jobs
from workers.scheduler import shutdown_scheduler, start_scheduler

__all__ = ["jobs", "shutdown_scheduler", "start_scheduler"]
