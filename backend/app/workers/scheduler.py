"""Backward-compatible scheduler module — prefer `python -m workers`."""
from workers.__main__ import main
from workers.scheduler import shutdown_scheduler, start_scheduler

__all__ = ["main", "shutdown_scheduler", "start_scheduler"]

if __name__ == "__main__":
    main()
