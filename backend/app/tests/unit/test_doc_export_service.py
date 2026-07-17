"""Unit tests for document export helpers."""
import pytest

from app.services import doc_export_service

pytestmark = pytest.mark.unit


def test_html_to_text_strips_tags():
    text = doc_export_service.html_to_text("<p>Hello <strong>world</strong></p>")
    assert "Hello world" in text


def test_html_to_text_empty_returns_blank():
    assert doc_export_service.html_to_text("") == ""
    assert doc_export_service.html_to_text(None) == ""


def test_sanitize_filename_strips_unsafe_chars():
    assert doc_export_service.sanitize_filename("My Doc: Q1!", "pdf") == "My Doc Q1.pdf"
    assert doc_export_service.sanitize_filename("", "txt") == "document.txt"


def test_export_docx_handles_rich_markup():
    data, media_type, filename = doc_export_service.export_document(
        "Rich",
        "<h1>H1</h1><h2>H2</h2><h3>H3</h3><p>Para with <strong>bold</strong> and <em>italic</em></p>"
        "<ul><li>One</li><li>Two<br/>split</li></ul><blockquote>Quote</blockquote>",
        "docx",
    )
    assert media_type.endswith("wordprocessingml.document")
    assert filename == "Rich.docx"
    assert data[:2] == b"PK"


def test_export_document_rejects_unknown_format():
    with pytest.raises(ValueError, match="Unsupported export format"):
        doc_export_service.export_document("Doc", "<p>x</p>", "rtf")


def test_export_text_includes_title():
    data, media_type, filename = doc_export_service.export_document("My Doc", "<p>Body</p>", "text")
    assert media_type.startswith("text/plain")
    assert filename == "My Doc.txt"
    assert b"My Doc" in data
    assert b"Body" in data


def test_export_docx_returns_docx_bytes():
    data, media_type, filename = doc_export_service.export_document(
        "Spec",
        "<h2>Section</h2><p>Detail</p>",
        "docx",
    )
    assert media_type.endswith("wordprocessingml.document")
    assert filename.endswith(".docx")
    assert data[:2] == b"PK"


def test_export_pdf_returns_pdf_bytes():
    data, media_type, filename = doc_export_service.export_document(
        "Spec",
        "<p>PDF body</p>",
        "pdf",
    )
    assert media_type == "application/pdf"
    assert filename.endswith(".pdf")
    assert data.startswith(b"%PDF")
