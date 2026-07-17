"""Unit tests for shared schema helpers."""
import pytest

from app.schemas.common import Page


@pytest.mark.unit
def test_page_pages_computes_total_pages():
    page = Page(items=[], total=25, page=1, page_size=10)
    assert page.pages == 3

    single = Page(items=["x"], total=0, page=1, page_size=10)
    assert single.pages == 1
