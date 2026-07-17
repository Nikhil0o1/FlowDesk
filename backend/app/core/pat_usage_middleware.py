"""Finalize PAT usage metrics after the response is produced."""

from __future__ import annotations

from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request
from starlette.responses import Response

from app.core.pat_usage import record_pat_usage


class PatUsageMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next) -> Response:
        try:
            response = await call_next(request)
        except Exception:
            self._finalize(request, status_code=500)
            raise
        self._finalize(request, status_code=response.status_code)
        return response

    @staticmethod
    def _finalize(request: Request, *, status_code: int) -> None:
        if not getattr(request.state, "pat_usage_pending", False):
            return
        if getattr(request.state, "pat_usage_recorded", False):
            return
        token_id = getattr(request.state, "pat_token_id", None)
        if token_id is None:
            return
        route = getattr(request.state, "pat_route", None) or request.url.path
        ip_address = getattr(request.state, "pat_ip", None)
        record_pat_usage(
            token_id=token_id,
            route=str(route),
            status_code=int(status_code),
            ip_address=ip_address,
        )
        request.state.pat_usage_recorded = True
