"""Phase 4 security — defense-in-depth HTTP response headers."""
import pytest


@pytest.mark.security
def test_security_headers_present_on_health(client):
    response = client.get("/health")
    assert response.status_code == 200
    assert response.headers.get("X-Content-Type-Options") == "nosniff"
    assert response.headers.get("X-Frame-Options") == "DENY"
    assert response.headers.get("Referrer-Policy") == "strict-origin-when-cross-origin"
    csp = response.headers.get("Content-Security-Policy", "")
    assert "frame-ancestors 'none'" in csp
    assert "default-src 'none'" in csp


@pytest.mark.security
def test_docs_csp_allows_swagger_cdn(client):
    response = client.get("/api/docs")
    assert response.status_code == 200
    csp = response.headers.get("Content-Security-Policy", "")
    assert "cdn.jsdelivr.net" in csp
    assert "unsafe-inline" in csp
    assert "fastapi.tiangolo.com" in csp
