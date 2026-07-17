"""All product emails - Brightcone-themed layout, shared send helpers."""
from urllib.parse import quote

from app.core.config import settings
from app.core.email_safety import escape_html
from app.core.emailer import send_email_async
from app.email.branding import email_product_name
from app.email.layout import render_blockquote, render_email_layout

BRAND = email_product_name()
_e = escape_html


def _layout(title: str, body_html: str, cta_label: str | None = None, cta_url: str | None = None) -> str:
    return render_email_layout(title, body_html, cta_label=cta_label, cta_url=cta_url)


def _fragment_token_url(path: str, token: str) -> str:
    return f"{settings.FRONTEND_URL}{path}?token={quote(token, safe='')}"


def _activate_url(token: str) -> str:
    return _fragment_token_url("/activate-invite", token)


def _accept_url(token: str) -> str:
    return _fragment_token_url("/activate-invite", token)


def _send_invite(to: str, subject: str, html: str, db=None, sender_id=None) -> None:
    """Send an invite email.

    By default everything goes via SMTP/SES from EMAIL_FROM (no-reply@brightcone.ai)
    so every message has one consistent sender. Only when INVITE_EMAILS_VIA_USER_GMAIL
    is enabled do invites go out through the inviter's connected Gmail (which forces
    the From to that person's own address); on any failure it falls back to SMTP."""
    if settings.INVITE_EMAILS_VIA_USER_GMAIL and db is not None and sender_id is not None:
        from app.services import google_service

        if google_service.try_gmail_send(db, sender_id, to, subject, html):
            return
    send_email_async(to, subject, html)


# ---------- Template 1: Invite (activate or accept) - clean copy, no role details ----------

def _invite_expiry_sentence() -> str:
    """Expiry note kept as a sentence (not its own <p>) so it can flow inline
    with the invite line — one clean paragraph instead of stacked blocks."""
    return (
        f"Activate your account to get started &mdash; the link expires in "
        f"{settings.INVITE_TOKEN_EXPIRE_HOURS} hours."
    )


def _invite_accept_expiry_sentence() -> str:
    return (
        f"Accept the invitation below &mdash; the link expires in "
        f"{settings.INVITE_TOKEN_EXPIRE_HOURS} hours."
    )


def send_new_user_invite_email(
    to: str,
    org_name: str,
    inviter_name: str,
    token: str,
    *,
    scope: str | None = None,
    role: str | None = None,
    workspace_name: str | None = None,
    space_name: str | None = None,
    project_name: str | None = None,
    db=None,
    sender_id=None,
) -> None:
    """New users who are not yet on the platform — a single onboarding email.

    When the invite scope/role are known this renders the "Welcome to {org}"
    design (headline + role-specific welcome line) with the activation button, so
    the invitee gets ONE email that both welcomes them and activates their
    account (no separate post-activation welcome). Without scope/role (generic
    onboarding aliases) it falls back to the plain "You're invited" copy."""
    if scope and role:
        title = f'Welcome to "{org_name}" organization'
        subject = f'Welcome to "{org_name}" organization on {BRAND}'
        body = (
            _role_access_body(
                scope,
                role,
                org_name=org_name,
                workspace_name=workspace_name,
                space_name=space_name,
                project_name=project_name,
                is_welcome=True,
            )
            + f"<p>{_invite_expiry_sentence()}</p>"
        )
    else:
        title = f'You\'re invited to "{org_name}" organization'
        subject = f'You\'re invited to "{org_name}" organization on {BRAND}'
        body = (
            f"<p>{_e(inviter_name)} has invited you to <strong>{_e(org_name)}</strong> on {BRAND}. "
            f"{_invite_expiry_sentence()}</p>"
        )
    _send_invite(
        to,
        subject,
        _layout(title, body, "Activate your account", _activate_url(token)),
        db=db,
        sender_id=sender_id,
    )


def send_existing_user_invite_email(
    to: str,
    scope: str,
    role: str,
    inviter_name: str,
    token: str,
    org_name: str,
    target_name: str,
    db=None,
    sender_id=None,
) -> None:
    """Existing users - same visual template; accept CTA. Role details sent after acceptance."""
    del scope, role
    title = f'You\'re invited to "{org_name}" organization'
    if target_name and target_name != org_name:
        intro = f"{_e(inviter_name)} has invited you to <strong>{_e(target_name)}</strong> on {BRAND}."
        subject = f"{inviter_name} invited you to {target_name} on {BRAND}"
    else:
        intro = f"{_e(inviter_name)} has invited you to <strong>{_e(org_name)}</strong> on {BRAND}."
        subject = f'{inviter_name} invited you to "{org_name}" organization on {BRAND}'
    body = f"<p>{intro} {_invite_accept_expiry_sentence()}</p>"
    _send_invite(
        to,
        subject,
        _layout(title, body, "Accept invitation", _accept_url(token)),
        db=db,
        sender_id=sender_id,
    )


def _bulk_place_item_html(target_name: str) -> str:
    """A place the invitee will get access to. No per-item link — a single
    account activation unlocks every pending invite at once."""
    return f'<li style="margin-bottom:6px;"><strong>{_e(target_name)}</strong></li>'


def _scope_name_slots(scope: str, target_name: str) -> dict[str, str | None]:
    """Route a single scope's display name into the right role-body keyword so
    the welcome copy reads naturally (e.g. project scope -> project_name)."""
    return {
        "workspace_name": target_name if scope == "workspace" else None,
        "space_name": target_name if scope == "space" else None,
        "project_name": target_name if scope == "project" else None,
    }


def _bulk_accept_item_html(target_name: str, token: str) -> str:
    return (
        f'<li style="margin-bottom:14px;">'
        f"<strong>{_e(target_name)}</strong><br/>"
        f'<a href="{_accept_url(token)}">Accept this invitation</a>'
        f"</li>"
    )


def send_bulk_existing_user_invite_email(
    to: str,
    inviter_name: str,
    org_name: str,
    items: list[tuple[str, str, str, str]],
    db=None,
    sender_id=None,
) -> None:
    """One email for an existing user invited to multiple places ? clean copy, no role details."""
    count = len(items)
    subject = (
        f"You're invited to {count} places on {BRAND}"
        if count > 1
        else f"You're invited to {items[0][2]} on {BRAND}"
    )
    title = f'You\'re invited to "{org_name}" organization'
    if count == 1:
        target = items[0][2]
        body = (
            f"<p>{_e(inviter_name)} has invited you to <strong>{_e(target)}</strong> on {BRAND}. "
            f"{_invite_accept_expiry_sentence()}</p>"
        )
        html = _layout(title, body, "Accept invitation", _accept_url(items[0][3]))
    else:
        body = (
            f"<p>{_e(inviter_name)} has invited you to <strong>{count}</strong> places on {BRAND}. "
            "Accept each invitation below:</p><ul>"
            + "".join(_bulk_accept_item_html(target, token) for _, _, target, token in items)
            + "</ul>"
            f"<p>{_invite_accept_expiry_sentence()}</p>"
        )
        html = _layout(title, body)
    _send_invite(to, subject, html, db=db, sender_id=sender_id)


def send_bulk_new_user_invite_email(
    to: str,
    inviter_name: str,
    org_name: str,
    items: list[tuple[str, str, str, str]],
    db=None,
    sender_id=None,
) -> None:
    """One invite email for a new user with multiple pending invites.

    A single "Activate your account" link is used for all of them: activating the
    account unlocks every pending invite for this email at once (see
    invite_service.activate_invite), so there is no per-place link to click.
    """
    count = len(items)
    title = f'Welcome to "{org_name}" organization'
    if count == 1:
        scope, role, target, _token = items[0]
        subject = f'Welcome to "{org_name}" organization on {BRAND}'
        names = _scope_name_slots(scope, target)
        body = (
            _role_access_body(scope, role, org_name=org_name, is_welcome=True, **names)
            + f"<p>{_invite_expiry_sentence()}</p>"
        )
    else:
        subject = f'Welcome to "{org_name}" organization on {BRAND}'
        body = (
            f"<p>Welcome to <strong>{_e(org_name)}</strong> on {BRAND}! "
            f"You've been given access to <strong>{count}</strong> places:</p>"
            "<ul>"
            + "".join(_bulk_place_item_html(target) for _, _, target, _ in items)
            + "</ul>"
            f"<p>Activating your account below unlocks all of them at once. "
            f"{_invite_expiry_sentence()}</p>"
        )
    # One token drives account activation; activate_invite grants every pending
    # invite for this email, so a single CTA is all the new user needs.
    html = _layout(title, body, "Activate your account", _activate_url(items[0][3]))
    _send_invite(to, subject, html, db=db, sender_id=sender_id)


# Backward-compatible aliases (routing in invite_service may still call these)
def send_owner_onboarding_email(to: str, org_name: str, inviter_name: str, token: str, db=None, sender_id=None) -> None:
    send_new_user_invite_email(to, org_name, inviter_name, token, db=db, sender_id=sender_id)


def send_org_admin_onboarding_email(to: str, org_name: str, inviter_name: str, token: str, db=None, sender_id=None) -> None:
    send_new_user_invite_email(to, org_name, inviter_name, token, db=db, sender_id=sender_id)


def send_org_member_onboarding_email(to: str, org_name: str, inviter_name: str, token: str, db=None, sender_id=None) -> None:
    send_new_user_invite_email(to, org_name, inviter_name, token, db=db, sender_id=sender_id)


def send_workspace_admin_onboarding_email(
    to: str, workspace_name: str, org_name: str, inviter_name: str, token: str, db=None, sender_id=None,
) -> None:
    del workspace_name
    send_new_user_invite_email(to, org_name, inviter_name, token, db=db, sender_id=sender_id)


def send_workspace_member_onboarding_email(
    to: str, workspace_name: str, org_name: str, inviter_name: str, token: str, db=None, sender_id=None,
) -> None:
    del workspace_name
    send_new_user_invite_email(to, org_name, inviter_name, token, db=db, sender_id=sender_id)


def send_space_admin_onboarding_email(
    to: str, space_name: str, org_name: str, inviter_name: str, token: str, db=None, sender_id=None,
) -> None:
    del space_name
    send_new_user_invite_email(to, org_name, inviter_name, token, db=db, sender_id=sender_id)


def send_space_member_onboarding_email(
    to: str, space_name: str, org_name: str, inviter_name: str, token: str, db=None, sender_id=None,
) -> None:
    del space_name
    send_new_user_invite_email(to, org_name, inviter_name, token, db=db, sender_id=sender_id)


def send_project_admin_onboarding_email(
    to: str, project_name: str, org_name: str, inviter_name: str, token: str, db=None, sender_id=None,
) -> None:
    del project_name
    send_new_user_invite_email(to, org_name, inviter_name, token, db=db, sender_id=sender_id)


def send_project_member_onboarding_email(
    to: str, project_name: str, org_name: str, inviter_name: str, token: str, db=None, sender_id=None,
) -> None:
    del project_name
    send_new_user_invite_email(to, org_name, inviter_name, token, db=db, sender_id=sender_id)


def send_project_viewer_onboarding_email(
    to: str, project_name: str, org_name: str, inviter_name: str, token: str, db=None, sender_id=None,
) -> None:
    del project_name
    send_new_user_invite_email(to, org_name, inviter_name, token, db=db, sender_id=sender_id)


# ---------- Template 2: Role access (welcome after onboarding, or assignment / role change) ----------

def _role_access_body(
    scope: str,
    role: str,
    *,
    org_name: str,
    workspace_name: str | None = None,
    space_name: str | None = None,
    project_name: str | None = None,
    is_welcome: bool = True,
) -> str:
    """Professional role summary for template 2 (HTML paragraph)."""
    if scope == "organization":
        if role == "owner":
            cap = (
                "As the organisation owner, you can manage workspaces, members and settings "
                "across the entire organisation."
            )
            assigned = (
                f"You are now the owner of <strong>{_e(org_name)}</strong>. You can manage workspaces, "
                "members and settings across the entire organisation."
            )
        elif role == "admin":
            cap = (
                "As an org admin, you can manage workspaces, spaces, projects and members "
                "across the entire organisation."
            )
            assigned = (
                f"You are now an org admin for <strong>{_e(org_name)}</strong>. You can manage workspaces, "
                "spaces, projects and members across the entire organisation."
            )
        else:
            cap = "As an org member, you can collaborate across workspaces in the organisation."
            assigned = (
                f"You are now a member of <strong>{_e(org_name)}</strong>. You can collaborate across "
                "workspaces in the organisation."
            )
    elif scope == "workspace":
        ws = _e(workspace_name or "this workspace")
        if role == "admin":
            cap = (
                f"As a workspace admin for <strong>{ws}</strong>, you can create projects, manage members "
                "and run sprints."
            )
            assigned = (
                f"You are now a workspace admin for <strong>{ws}</strong>. You can create projects, "
                "manage members and run sprints."
            )
        else:
            cap = (
                f"As a workspace member of <strong>{ws}</strong>, you can collaborate on projects, "
                "tasks and sprints."
            )
            assigned = (
                f"You are now a workspace member of <strong>{ws}</strong>. You can collaborate on projects, "
                "tasks and sprints."
            )
    elif scope == "space":
        sp = _e(space_name or "this space")
        ws = _e(workspace_name or "this workspace")
        if role == "admin":
            cap = (
                f"As a space admin for <strong>{sp}</strong>, you can manage space settings, members "
                "and projects."
            )
            assigned = (
                f"You are now a space admin for <strong>{sp}</strong> in <strong>{ws}</strong>. "
                "You can manage space settings, members and projects."
            )
        else:
            cap = (
                f"As a space member in <strong>{sp}</strong>, you can collaborate on projects and tasks "
                "in this space."
            )
            assigned = (
                f"You are now a space member in <strong>{sp}</strong> (<strong>{ws}</strong>). "
                "You can collaborate on projects and tasks in this space."
            )
    elif scope == "project":
        pr = _e(project_name or "this project")
        if role == "admin":
            cap = (
                f"As a project admin for <strong>{pr}</strong>, you can manage project settings, "
                "members and tasks."
            )
            assigned = (
                f"You are now a project admin for <strong>{pr}</strong>. You can manage project settings, "
                "members and tasks."
            )
        elif role == "viewer":
            cap = f"As a project viewer on <strong>{pr}</strong>, you can follow tasks and track progress."
            assigned = (
                f"You are now a project viewer on <strong>{pr}</strong>. You can follow tasks and track progress."
            )
        else:
            cap = (
                f"As a project member on <strong>{pr}</strong>, you can work on tasks and collaborate "
                "with your team."
            )
            assigned = (
                f"You are now a project member on <strong>{pr}</strong>. You can work on tasks and collaborate "
                "with your team."
            )
    else:
        cap = f"Your access on {BRAND} has been updated."
        assigned = cap

    text = cap if is_welcome else assigned
    return f"<p>{text}</p>"


def role_access_email_content(
    scope: str,
    role: str,
    *,
    org_name: str,
    workspace_name: str | None = None,
    space_name: str | None = None,
    project_name: str | None = None,
    is_welcome: bool = True,
) -> tuple[str, str, str]:
    """Return (subject, title, body_html) for template 2."""
    title = f'Welcome to "{org_name}" organization' if is_welcome else "Your access has been updated"
    body = _role_access_body(
        scope,
        role,
        org_name=org_name,
        workspace_name=workspace_name,
        space_name=space_name,
        project_name=project_name,
        is_welcome=is_welcome,
    )
    if is_welcome:
        subject = f'Welcome to "{org_name}" organization on {BRAND}'
    elif scope == "workspace" and workspace_name:
        subject = f"Your role in {workspace_name} was updated on {BRAND}"
    elif scope == "space" and space_name:
        subject = f"Your role in {space_name} was updated on {BRAND}"
    elif scope == "project" and project_name:
        subject = f"Your role in {project_name} was updated on {BRAND}"
    else:
        subject = f'Your access in "{org_name}" organization was updated on {BRAND}'
    return subject, title, body


def send_role_access_email(
    to: str,
    scope: str,
    role: str,
    *,
    org_name: str,
    workspace_name: str | None = None,
    space_name: str | None = None,
    project_name: str | None = None,
    is_welcome: bool = True,
) -> None:
    """Template 2 - role summary after onboarding, invite acceptance, or role change."""
    subject, title, body = role_access_email_content(
        scope,
        role,
        org_name=org_name,
        workspace_name=workspace_name,
        space_name=space_name,
        project_name=project_name,
        is_welcome=is_welcome,
    )
    send_email_async(to, subject, _layout(title, body))


# ---------- Task / mention / reply ----------

def send_task_assigned_email(to: str, task_title: str, task_ref: str, assigner_name: str, task_url: str) -> None:
    send_email_async(
        to,
        f"[{_e(task_ref)}] {_e(assigner_name)} assigned you a task",
        _layout(
            "New task assigned to you",
            f"<p><strong>{_e(assigner_name)}</strong> assigned you <strong>{_e(task_ref)} &mdash; {_e(task_title)}</strong>.</p>",
            "Open task",
            task_url,
        ),
    )


def send_doc_shared_email(to: str, doc_title: str, sharer_name: str, url: str) -> None:
    send_email_async(
        to,
        f'{_e(sharer_name)} shared a doc with you: {_e(doc_title)}',
        _layout(
            "A document was shared with you",
            f"<p><strong>{_e(sharer_name)}</strong> shared <strong>{_e(doc_title)}</strong> with you on {BRAND}.</p>",
            "Open document",
            url,
        ),
    )


def send_task_shared_email(to: str, task_title: str, task_ref: str, sharer_name: str, url: str) -> None:
    send_email_async(
        to,
        f"{_e(sharer_name)} shared a task with you: {_e(task_ref)}",
        _layout(
            "A task was shared with you",
            f"<p><strong>{_e(sharer_name)}</strong> shared <strong>{_e(task_ref)} &mdash; {_e(task_title)}</strong> with you on {BRAND}.</p>",
            "Open task",
            url,
        ),
    )


def send_mention_email(to: str, author_name: str, context: str, excerpt: str, url: str) -> None:
    send_email_async(
        to,
        f"{_e(author_name)} mentioned you in {_e(context)}",
        _layout(
            "You were mentioned",
            f"<p><strong>{_e(author_name)}</strong> mentioned you in {_e(context)}:</p>"
            f"{render_blockquote(excerpt)}",
            "View conversation",
            url,
        ),
    )


def send_comment_reply_email(to: str, author_name: str, task_ref: str, excerpt: str, url: str) -> None:
    send_email_async(
        to,
        f"{_e(author_name)} replied to your comment on {_e(task_ref)}",
        _layout(
            "New reply to your comment",
            f"<p><strong>{_e(author_name)}</strong> replied on <strong>{_e(task_ref)}</strong>:</p>"
            f"{render_blockquote(excerpt)}",
            "View reply",
            url,
        ),
    )


# ---------- Due date reminder ----------

def send_due_date_reminder_email(to: str, task_title: str, task_ref: str, due_label: str, task_url: str) -> None:
    send_email_async(
        to,
        f"[{_e(task_ref)}] due {_e(due_label)}: {_e(task_title)}",
        _layout(
            f"Task due {_e(due_label)}",
            f"<p><strong>{_e(task_ref)} &mdash; {_e(task_title)}</strong> is due <strong>{_e(due_label)}</strong>.</p>",
            "Open task",
            task_url,
        ),
    )


# ---------- Sprints ----------

def send_sprint_started_email(to: str, sprint_name: str, goal: str | None, end_date: str | None, url: str) -> None:
    goal_html = f"<p>Sprint goal: <em>{_e(goal)}</em></p>" if goal else ""
    end_html = f"<p>Ends on <strong>{_e(end_date)}</strong>.</p>" if end_date else ""
    send_email_async(
        to,
        f"Sprint started: {_e(sprint_name)}",
        _layout("Sprint started", f"<p><strong>{_e(sprint_name)}</strong> is now active.</p>{goal_html}{end_html}", "Open sprint board", url),
    )


def send_sprint_completed_email(to: str, sprint_name: str, completed_points: int, total_points: int, url: str) -> None:
    send_email_async(
        to,
        f"Sprint completed: {_e(sprint_name)}",
        _layout(
            "Sprint completed",
            f"<p><strong>{_e(sprint_name)}</strong> has been completed with "
            f"<strong>{completed_points} of {total_points} story points</strong> done.</p>",
            "View summary",
            url,
        ),
    )


# ---------- Login OTP ----------

def send_login_otp_email(to: str, code: str, expire_minutes: int) -> None:
    send_email_async(
        to,
        f"Your {BRAND} sign-in code: {code}",
        _layout(
            "Your sign-in code",
            f"<p>Use this code to sign in to {BRAND}:</p>"
            f"<p style=\"font-size:28px;font-weight:700;letter-spacing:6px;margin:18px 0\">{code}</p>"
            f"<p>This code expires in {expire_minutes} minutes. If you didn't request it, you can ignore this email.</p>",
        ),
    )


# ---------- Daily digest ----------

def send_daily_digest_email(to: str, full_name: str, items_html: str) -> None:
    send_email_async(
        to,
        f"Your {BRAND} daily digest",
        _layout(
            f"Good morning{', ' + _e(full_name) if full_name else ''}",
            f"<p>Here's what needs your attention today:</p>{items_html}",
            "Open dashboard",
            f"{settings.FRONTEND_URL}/app/dashboard",
        ),
    )


# ---------- GitHub ----------

def send_github_pr_email(to: str, action: str, pr_title: str, repo: str, url: str) -> None:
    send_email_async(
        to,
        f"PR {_e(action)} in {_e(repo)}: {_e(pr_title)}",
        _layout(
            f"Pull request {_e(action)}",
            f"<p><strong>{_e(pr_title)}</strong> was {_e(action)} in <strong>{_e(repo)}</strong>.</p>",
            "View activity",
            url,
        ),
    )


def send_test_notification_email(to: str) -> None:
    send_email_async(
        to,
        "FlowDesk test notification",
        _layout(
            "Test notification",
            "<p>This is a test email from FlowDesk notification settings. "
            "If you received this, email notifications are working.</p>",
            "Open inbox",
            f"{settings.FRONTEND_URL}/app/notifications",
        ),
    )


def send_webhook_disabled_email(
    to: str,
    *,
    endpoint_url: str,
    failure_count: int,
    settings_url: str,
) -> None:
    send_email_async(
        to,
        f"Webhook auto-disabled: {_e(endpoint_url)}",
        _layout(
            "Webhook endpoint auto-disabled",
            (
                f"<p>Your webhook endpoint <strong>{_e(endpoint_url)}</strong> was "
                f"automatically disabled after <strong>{failure_count}</strong> consecutive "
                f"delivery failures.</p>"
                "<p>Re-enable it from organization Settings &rarr; Webhooks after fixing "
                "the receiver, then use Test or Redeliver to verify.</p>"
            ),
            "Open webhook settings",
            settings_url,
        ),
    )
