"""Email layout tests."""
from app.email.assets import BRIGHTCONE_LOGO_CID, load_brightcone_logo
from app.email.branding import email_product_name
from app.email.layout import render_blockquote, render_email_layout
from app.email.mime import build_email_message


def test_email_layout_uses_cid_logo_when_asset_present():
    assert load_brightcone_logo() is not None
    html = render_email_layout("Hello", "<p>Body</p>", cta_label="Go", cta_url="https://example.com/go")
    assert "FlowDesk" in html
    assert "#2B88EE" in html
    assert f"cid:{BRIGHTCONE_LOGO_CID}" in html


def test_email_product_name_uses_explicit_setting(monkeypatch):
    monkeypatch.setattr("app.email.branding.settings.EMAIL_PRODUCT_NAME", "FlowDesk")
    assert email_product_name() == "FlowDesk"


def test_email_message_embeds_inline_logo():
    html = render_email_layout("Hello", "<p>Body</p>")
    msg = build_email_message(
        to="user@example.com",
        subject="Test",
        html=html,
        from_addr="FlowDesk <no-reply@test.local>",
    )
    payload = msg.as_string()
    assert "Content-ID: <brightcone-logo@flowdesk>" in payload
    assert "multipart/related" in payload


def test_blockquote_uses_brand_accent():
    html = render_blockquote("quoted text")
    assert "#2B88EE" in html
    assert "quoted text" in html


def test_layout_closing_block_has_support_mailto_and_signature(monkeypatch):
    monkeypatch.setattr("app.email.layout.settings.SUPPORT_EMAIL", "help@example.com")
    html = render_email_layout("Hello", "<p>Body</p>")
    assert "mailto:help@example.com" in html
    assert "For any questions, contact us at" in html
    assert "The FlowDesk Team" in html


def test_layout_support_link_omitted_when_no_support_email(monkeypatch):
    monkeypatch.setattr("app.email.layout.settings.SUPPORT_EMAIL", "")
    html = render_email_layout("Hello", "<p>Body</p>")
    assert "For any questions" not in html
    # The signature still renders without a support address.
    assert "The FlowDesk Team" in html


def test_layout_footer_band_has_legal_links():
    html = render_email_layout("Hello", "<p>Body</p>")
    assert "All rights reserved" in html
    assert "Privacy Policy" in html
    assert "Terms of Service" in html
    assert "brightcone.ai" in html


def test_smtp_backend_embeds_inline_logo(monkeypatch):
    from unittest.mock import MagicMock, patch

    from app.core.emailer import SMTPBackend
    from app.email.layout import render_email_layout

    monkeypatch.setattr("app.core.emailer.settings.EMAIL_FROM", "FlowDesk <no-reply@test.local>")
    monkeypatch.setattr("app.core.emailer.settings.EMAIL_SMTP_SERVER", "smtp.test.local")
    monkeypatch.setattr("app.core.emailer.settings.EMAIL_SMTP_PORT", 587)
    monkeypatch.setattr("app.core.emailer.settings.EMAIL_USERNAME", "user")
    monkeypatch.setattr("app.core.emailer.settings.EMAIL_PASSWORD", "pass")

    html = render_email_layout("Hello", "<p>Body</p>")
    smtp = MagicMock()
    smtp.__enter__ = MagicMock(return_value=smtp)
    smtp.__exit__ = MagicMock(return_value=False)

    with patch("smtplib.SMTP", return_value=smtp):
        SMTPBackend().send("user@example.com", "Test", html)

    payload = smtp.sendmail.call_args[0][2]
    if isinstance(payload, bytes):
        payload = payload.decode("utf-8", errors="replace")
    assert "Content-ID: <brightcone-logo@flowdesk>" in payload
    assert "multipart/related" in payload
