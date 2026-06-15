"""All product emails. Professional B2B style, single shared layout."""
from app.core.config import settings
from app.core.emailer import send_email_async

BRAND = settings.APP_NAME
ACCENT = "#8C5BFF"


def _layout(title: str, body_html: str, cta_label: str | None = None, cta_url: str | None = None) -> str:
    cta = ""
    if cta_label and cta_url:
        cta = f"""
        <table role="presentation" cellpadding="0" cellspacing="0" style="margin:28px 0;">
          <tr><td style="border-radius:8px;background:{ACCENT};">
            <a href="{cta_url}" style="display:inline-block;padding:12px 28px;font-size:14px;font-weight:600;
               color:#ffffff;text-decoration:none;border-radius:8px;font-family:Segoe UI,Arial,sans-serif;">
              {cta_label}
            </a>
          </td></tr>
        </table>"""
    return f"""<!doctype html>
<html><body style="margin:0;padding:0;background:#f4f5f7;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f5f7;padding:32px 0;">
  <tr><td align="center">
    <table role="presentation" width="560" cellpadding="0" cellspacing="0"
           style="background:#ffffff;border-radius:12px;border:1px solid #e6e8ec;overflow:hidden;">
      <tr><td style="padding:28px 40px 0;">
        <div style="font-family:Segoe UI,Arial,sans-serif;font-size:18px;font-weight:700;color:#1f2330;">
          <span style="display:inline-block;width:10px;height:10px;border-radius:3px;background:{ACCENT};margin-right:8px;"></span>{BRAND}
        </div>
      </td></tr>
      <tr><td style="padding:24px 40px 8px;">
        <h1 style="margin:0;font-family:Segoe UI,Arial,sans-serif;font-size:20px;color:#1f2330;">{title}</h1>
      </td></tr>
      <tr><td style="padding:4px 40px 8px;font-family:Segoe UI,Arial,sans-serif;font-size:14px;line-height:22px;color:#4b5263;">
        {body_html}
        {cta}
      </td></tr>
      <tr><td style="padding:20px 40px 28px;border-top:1px solid #eef0f3;">
        <p style="margin:12px 0 0;font-family:Segoe UI,Arial,sans-serif;font-size:12px;color:#9aa1ad;">
          You received this email because you have a {BRAND} account or were invited to one.
          If you weren't expecting this, you can safely ignore it.
        </p>
      </td></tr>
    </table>
  </td></tr>
</table>
</body></html>"""


def _activate_url(token: str) -> str:
    return f"{settings.FRONTEND_URL}/activate-invite?token={token}"


def _accept_url(token: str) -> str:
    return f"{settings.FRONTEND_URL}/activate-invite?token={token}&existing=1"


def _send_invite(to: str, subject: str, html: str, db=None, sender_id=None) -> None:
    """Invite emails go out from the inviter's own Gmail when they've connected
    it with the gmail.send scope; otherwise (or on any failure) via SMTP."""
    if db is not None and sender_id is not None:
        from app.services import google_service

        if google_service.try_gmail_send(db, sender_id, to, subject, html):
            return
    send_email_async(to, subject, html)


# ---------- 1-3. Onboarding emails (new users) ----------

def send_owner_onboarding_email(to: str, org_name: str, inviter_name: str, token: str, db=None, sender_id=None) -> None:
    _send_invite(
        to,
        f"You've been invited to own {org_name} on {BRAND}",
        _layout(
            f"Welcome to {BRAND}",
            f"<p>{inviter_name} has set you up as the <strong>owner of {org_name}</strong> on {BRAND} — "
            f"the workspace where your team plans, tracks and ships work.</p>"
            f"<p>Activate your account and choose a password to get started. "
            f"This link expires in {settings.INVITE_TOKEN_EXPIRE_HOURS} hours and can be used once.</p>",
            "Activate your account",
            _activate_url(token),
        ),
        db=db,
        sender_id=sender_id,
    )


def send_workspace_admin_onboarding_email(to: str, workspace_name: str, org_name: str, inviter_name: str, token: str, db=None, sender_id=None) -> None:
    _send_invite(
        to,
        f"{inviter_name} invited you to manage {workspace_name}",
        _layout(
            f"You're invited to {org_name}",
            f"<p>{inviter_name} invited you to join <strong>{org_name}</strong> as an "
            f"<strong>admin of the {workspace_name} workspace</strong>.</p>"
            f"<p>As a workspace admin you can create projects, manage members and run sprints. "
            f"Activate your account to get started — the link expires in {settings.INVITE_TOKEN_EXPIRE_HOURS} hours.</p>",
            "Activate your account",
            _activate_url(token),
        ),
        db=db,
        sender_id=sender_id,
    )


def send_project_member_onboarding_email(to: str, project_name: str, org_name: str, inviter_name: str, token: str, db=None, sender_id=None) -> None:
    _send_invite(
        to,
        f"{inviter_name} invited you to {project_name}",
        _layout(
            f"You're invited to {org_name}",
            f"<p>{inviter_name} invited you to collaborate on <strong>{project_name}</strong> in {org_name}.</p>"
            f"<p>Activate your account and choose a password to see your tasks. "
            f"The link expires in {settings.INVITE_TOKEN_EXPIRE_HOURS} hours.</p>",
            "Join the project",
            _activate_url(token),
        ),
        db=db,
        sender_id=sender_id,
    )


# ---------- 4. Existing user invited ----------

def send_existing_user_invite_email(to: str, target_name: str, scope: str, inviter_name: str, token: str, db=None, sender_id=None) -> None:
    _send_invite(
        to,
        f"{inviter_name} added you to {target_name}",
        _layout(
            f"New {scope} invitation",
            f"<p>{inviter_name} invited you to join the <strong>{target_name}</strong> {scope} on {BRAND}.</p>"
            f"<p>You already have an account — no password change needed. Just accept the invitation below.</p>",
            "Accept invitation",
            _accept_url(token),
        ),
        db=db,
        sender_id=sender_id,
    )


# ---------- 5-7. Task / mention / reply ----------

def send_task_assigned_email(to: str, task_title: str, task_ref: str, assigner_name: str, task_url: str) -> None:
    send_email_async(
        to,
        f"[{task_ref}] {assigner_name} assigned you a task",
        _layout(
            "New task assigned to you",
            f"<p><strong>{assigner_name}</strong> assigned you <strong>{task_ref} — {task_title}</strong>.</p>",
            "Open task",
            task_url,
        ),
    )


def send_mention_email(to: str, author_name: str, context: str, excerpt: str, url: str) -> None:
    send_email_async(
        to,
        f"{author_name} mentioned you in {context}",
        _layout(
            "You were mentioned",
            f"<p><strong>{author_name}</strong> mentioned you in {context}:</p>"
            f"<blockquote style='margin:12px 0;padding:10px 16px;border-left:3px solid {ACCENT};"
            f"background:#f7f7fb;color:#4b5263;'>{excerpt}</blockquote>",
            "View conversation",
            url,
        ),
    )


def send_comment_reply_email(to: str, author_name: str, task_ref: str, excerpt: str, url: str) -> None:
    send_email_async(
        to,
        f"{author_name} replied to your comment on {task_ref}",
        _layout(
            "New reply to your comment",
            f"<p><strong>{author_name}</strong> replied on <strong>{task_ref}</strong>:</p>"
            f"<blockquote style='margin:12px 0;padding:10px 16px;border-left:3px solid {ACCENT};"
            f"background:#f7f7fb;color:#4b5263;'>{excerpt}</blockquote>",
            "View reply",
            url,
        ),
    )


# ---------- 8. Due date reminder ----------

def send_due_date_reminder_email(to: str, task_title: str, task_ref: str, due_label: str, task_url: str) -> None:
    send_email_async(
        to,
        f"[{task_ref}] due {due_label}: {task_title}",
        _layout(
            f"Task due {due_label}",
            f"<p><strong>{task_ref} — {task_title}</strong> is due <strong>{due_label}</strong>.</p>",
            "Open task",
            task_url,
        ),
    )


# ---------- 9-10. Sprints ----------

def send_sprint_started_email(to: str, sprint_name: str, goal: str | None, end_date: str | None, url: str) -> None:
    goal_html = f"<p>Sprint goal: <em>{goal}</em></p>" if goal else ""
    end_html = f"<p>Ends on <strong>{end_date}</strong>.</p>" if end_date else ""
    send_email_async(
        to,
        f"Sprint started: {sprint_name}",
        _layout("Sprint started", f"<p><strong>{sprint_name}</strong> is now active.</p>{goal_html}{end_html}", "Open sprint board", url),
    )


def send_sprint_completed_email(to: str, sprint_name: str, completed_points: int, total_points: int, url: str) -> None:
    send_email_async(
        to,
        f"Sprint completed: {sprint_name}",
        _layout(
            "Sprint completed",
            f"<p><strong>{sprint_name}</strong> has been completed with "
            f"<strong>{completed_points} of {total_points} story points</strong> done.</p>",
            "View summary",
            url,
        ),
    )


# ---------- 11. Password reset ----------

def send_password_reset_email(to: str, token: str) -> None:
    url = f"{settings.FRONTEND_URL}/reset-password?token={token}"
    send_email_async(
        to,
        f"Reset your {BRAND} password",
        _layout(
            "Reset your password",
            f"<p>We received a request to reset your {BRAND} password. "
            f"This link expires in {settings.PASSWORD_RESET_TOKEN_EXPIRE_MINUTES} minutes and can be used once.</p>"
            f"<p>If you didn't request this, ignore this email — your password will stay the same.</p>",
            "Choose a new password",
            url,
        ),
    )


# ---------- 12. Daily digest ----------

def send_daily_digest_email(to: str, full_name: str, items_html: str) -> None:
    send_email_async(
        to,
        f"Your {BRAND} daily digest",
        _layout(
            f"Good morning{', ' + full_name if full_name else ''}",
            f"<p>Here's what needs your attention today:</p>{items_html}",
            "Open dashboard",
            f"{settings.FRONTEND_URL}/app/dashboard",
        ),
    )


# ---------- GitHub ----------

def send_github_pr_email(to: str, action: str, pr_title: str, repo: str, url: str) -> None:
    send_email_async(
        to,
        f"PR {action} in {repo}: {pr_title}",
        _layout(
            f"Pull request {action}",
            f"<p><strong>{pr_title}</strong> was {action} in <strong>{repo}</strong>.</p>",
            "View activity",
            url,
        ),
    )
