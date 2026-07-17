"""Shared HTML layout for all product emails."""
import uuid
from datetime import datetime, timezone
from html import escape

from app.core.config import settings
from app.email.brightcone_theme import THEME
from app.email.assets import brightcone_logo_src
from app.email.branding import email_product_name

# Static company / legal details shown in the dark footer band. Update here if the
# registered entity or legal URLs change.
_COPYRIGHT_YEAR = 2026
_COMPANY_LEGAL_NAME = "Brightcone Inc"
_WEBSITE_LABEL = "brightcone.ai"
_WEBSITE_URL = "https://brightcone.ai"
_UNSUBSCRIBE_URL = "https://brightcone.ai/unsubscribe"
_PRIVACY_URL = "https://brightcone.ai/privacy"
_TERMS_URL = "https://brightcone.ai/terms"


def render_cta_button(label: str, url: str) -> str:
    safe_label = escape(label)
    safe_url = escape(url, quote=True)
    return f"""
        <table role="presentation" cellpadding="0" cellspacing="0" style="margin:28px 0;">
          <tr>
            <td style="border-radius:8px;background-color:{THEME.brand_blue};
                background-image:{THEME.cta_gradient};">
              <a href="{safe_url}" style="display:inline-block;padding:12px 28px;font-size:14px;
                 font-weight:600;color:#ffffff;text-decoration:none;border-radius:8px;
                 font-family:{THEME.font_stack};">
                {safe_label}
              </a>
            </td>
          </tr>
        </table>"""


def render_closing_block() -> str:
    """Standard sign-off: a minimal support line plus signature."""
    support_email = settings.support_email
    support_html = ""
    if support_email:
        safe_mailto = escape(f"mailto:{support_email}", quote=True)
        support_html = (
            f'For any questions, contact us at <a href="{safe_mailto}" style="color:{THEME.brand_blue};'
            f'text-decoration:underline;font-weight:600;">{escape(support_email)}</a>.'
        )
    para = f"font-family:{THEME.font_stack};font-size:14px;line-height:22px;color:{THEME.fg_secondary};"
    support_para = f'<p style="margin:20px 0 0;{para}">{support_html}</p>' if support_html else ""
    return (
        f"{support_para}"
        f'<p style="margin:20px 0 0;{para}">'
        f"— The {escape(email_product_name())} Team"
        f"</p>"
    )


def render_footer_band() -> str:
    """Dark branded footer band: copyright, website/unsubscribe and legal links."""
    year = _COPYRIGHT_YEAR
    link = f"color:{THEME.footer_band_fg_muted};text-decoration:none;"
    line = f"margin:0 0 6px;font-family:{THEME.font_stack};font-size:12px;line-height:18px;"
    return f"""
          <tr>
            <td align="center" style="padding:22px 40px;background:{THEME.footer_band_gradient};">
              <p style="{line}color:{THEME.footer_band_fg};font-weight:600;">
                &copy; {year} {escape(_COMPANY_LEGAL_NAME)}. All rights reserved.
              </p>
              <p style="{line}color:{THEME.footer_band_fg_muted};">
                <a href="{escape(_WEBSITE_URL, quote=True)}" style="{link}">{escape(_WEBSITE_LABEL)}</a>
                &nbsp;&#124;&nbsp;
                <a href="{escape(_UNSUBSCRIBE_URL, quote=True)}" style="{link}">Unsubscribe</a>
              </p>
              <p style="margin:0;font-family:{THEME.font_stack};font-size:12px;line-height:18px;
                 color:{THEME.footer_band_fg_muted};">
                <a href="{escape(_PRIVACY_URL, quote=True)}" style="{link}">Privacy Policy</a>
                &nbsp;&#124;&nbsp;
                <a href="{escape(_TERMS_URL, quote=True)}" style="{link}">Terms of Service</a>
              </p>
            </td>
          </tr>"""


def render_blockquote(excerpt: str) -> str:
    safe_excerpt = escape(excerpt)
    return (
        f"<blockquote style='margin:12px 0;padding:12px 16px;border-left:3px solid {THEME.brand_blue};"
        f"background:{THEME.quote_bg};color:{THEME.fg_secondary};border-radius:0 8px 8px 0;"
        f"font-family:{THEME.font_stack};font-size:14px;line-height:22px;'>{safe_excerpt}</blockquote>"
    )


def _render_header() -> str:
    logo_url = escape(brightcone_logo_src(), quote=True)
    return f"""
      <tr>
        <td style="height:6px;background:{THEME.accent_bar_gradient};font-size:0;line-height:0;">&nbsp;</td>
      </tr>
      <tr>
        <td align="center" style="padding:32px 40px 26px;background:{THEME.header_gradient};">
          <img src="{logo_url}" alt="Bright Cone" width="260"
               style="display:block;width:260px;max-width:82%;height:auto;border:0;margin:0 auto;" />
        </td>
      </tr>"""


def _dedupe_marker() -> str:
    """A hidden, per-send unique token placed at the very end of the email.

    Gmail collapses trailing content that is byte-identical to earlier messages
    (its "..." trimmed-content toggle), which otherwise chops our shared footer
    band. A unique invisible token as the last element breaks that bottom-up
    match so the footer always renders in full. It is not visible to the reader."""
    token = f"{datetime.now(timezone.utc).strftime('%Y%m%d%H%M%S')}-{uuid.uuid4().hex}"
    return (
        '<div style="display:none;max-height:0;overflow:hidden;mso-hide:all;'
        'font-size:0;line-height:0;color:transparent;opacity:0;">'
        f"{token}"
        "</div>"
    )


def render_email_layout(
    title: str,
    body_html: str,
    *,
    cta_label: str | None = None,
    cta_url: str | None = None,
) -> str:
    safe_title = escape(title)
    cta = ""
    if cta_label and cta_url:
        cta = render_cta_button(cta_label, cta_url)

    return f"""<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <meta name="color-scheme" content="light" />
  <title>{safe_title}</title>
</head>
<body style="margin:0;padding:0;background:{THEME.ink_950};">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0"
         style="background:{THEME.ink_950};padding:32px 16px;">
    <tr>
      <td align="center">
        <table role="presentation" width="640" cellpadding="0" cellspacing="0"
               style="max-width:640px;width:100%;background:{THEME.card_bg};overflow:hidden;">
          {_render_header()}
          <tr>
            <td style="padding:24px 40px 8px;">
              <h1 style="margin:0;font-family:{THEME.font_stack};font-size:20px;font-weight:700;
                 color:{THEME.fg};letter-spacing:-0.02em;">
                {safe_title}
              </h1>
            </td>
          </tr>
          <tr>
            <td style="padding:4px 40px 20px;font-family:{THEME.font_stack};font-size:14px;
               line-height:22px;color:{THEME.fg_secondary};">
              {body_html}
              {cta}
              {render_closing_block()}
            </td>
          </tr>
          <tr>
            <td style="padding:8px 40px 24px;">
              <p style="margin:0;font-family:{THEME.font_stack};font-size:12px;
                 line-height:18px;color:{THEME.fg_muted};">
                You received this email because you have a {escape(email_product_name())} account
                or were invited to one. If you weren't expecting this, you can safely ignore it.
              </p>
            </td>
          </tr>
          {render_footer_band()}
        </table>
      </td>
    </tr>
  </table>
  {_dedupe_marker()}
</body>
</html>"""
