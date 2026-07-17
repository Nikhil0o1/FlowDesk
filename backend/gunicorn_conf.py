"""Gunicorn config for load-balanced API deployments.

Usage:
    gunicorn app.main:app -c gunicorn_conf.py
"""
import multiprocessing
import os

bind = f"0.0.0.0:{os.environ.get('PORT', '8000')}"
workers = int(os.environ.get("WEB_CONCURRENCY", max(2, multiprocessing.cpu_count())))
worker_class = "uvicorn.workers.UvicornWorker"
timeout = 120
keepalive = 5
preload_app = True
accesslog = "-"
errorlog = "-"
loglevel = os.environ.get("LOG_LEVEL", "info")
