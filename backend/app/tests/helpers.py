"""Shared test data builders for API integration tests."""
from datetime import datetime, timedelta, timezone

from app.models.organization import OrganizationMember
from app.models.project import Project, ProjectMember, Space
from app.models.task import Task
from app.models.workspace import Workspace, WorkspaceMember
from app.tests.conftest import make_user


def build_project_stack(db, org, owner, *, project_name: str = "Proj", **_: object):
    """Org owner workspace → space → project with default admin membership."""
    workspace = Workspace(organization_id=org.id, name="WS", created_by=owner.id)
    db.add(workspace)
    db.flush()
    db.add(WorkspaceMember(workspace_id=workspace.id, user_id=owner.id, role="admin"))
    space = Space(workspace_id=workspace.id, name="Space", created_by=owner.id)
    db.add(space)
    db.flush()
    project = Project(
        space_id=space.id,
        workspace_id=workspace.id,
        name=project_name,
        created_by=owner.id,
    )
    db.add(project)
    db.flush()
    db.add(ProjectMember(project_id=project.id, user_id=owner.id, role="admin"))
    db.flush()
    return workspace, project


def add_project_member(db, org, workspace, project, email: str, role: str = "member"):
    user = make_user(db, email)
    db.add(OrganizationMember(organization_id=org.id, user_id=user.id, role="member"))
    db.add(WorkspaceMember(workspace_id=workspace.id, user_id=user.id, role="member"))
    db.add(ProjectMember(project_id=project.id, user_id=user.id, role=role))
    db.flush()
    return user


def add_task(db, project, owner, title: str = "Task", number: int = 1) -> Task:
    task = Task(project_id=project.id, number=number, title=title, created_by=owner.id)
    project.next_task_number = max(project.next_task_number or 1, number + 1)
    db.add(task)
    db.flush()
    return task


def seed_personal_github(db, org, user, *, token: str = "gh-token"):
    """Personal GitHub OAuth connection for org + user."""
    from app.models.github import CONNECTION_PERSONAL, GithubConnection

    conn = GithubConnection(
        organization_id=org.id,
        user_id=user.id,
        connection_type=CONNECTION_PERSONAL,
        access_token=token,
        scope="repo",
        github_user_login="dev-user",
        github_user_id=12345,
        connected_by=user.id,
    )
    db.add(conn)
    db.flush()
    return conn


def seed_project_github(db, org, project, user, *, token: str = "gh-token", **kwargs):
    """Project-scoped GitHub OAuth connection."""
    from app.models.github import CONNECTION_PROJECT, GithubConnection

    conn = GithubConnection(
        organization_id=org.id,
        project_id=project.id,
        connection_type=CONNECTION_PROJECT,
        access_token=token,
        scope="repo",
        github_user_login=kwargs.get("github_user_login", "proj-bot"),
        github_user_id=kwargs.get("github_user_id", 54321),
        connected_by=user.id,
        branch_name_format=kwargs.get("branch_name_format", ":taskId:-:taskName:"),
        connected_search_enabled=kwargs.get("connected_search_enabled", True),
    )
    db.add(conn)
    db.flush()
    return conn


def seed_github_repo(db, workspace, project, conn, *, repo_full_name: str = "acme/app", **kwargs):
    """Active linked GitHub repository for a project."""
    from app.models.github import GithubRepository

    repo = GithubRepository(
        connection_id=conn.id,
        workspace_id=workspace.id,
        project_id=project.id,
        repo_id=kwargs.get("repo_id", 99001),
        repo_full_name=repo_full_name,
        default_branch=kwargs.get("default_branch", "main"),
        is_active=True,
        connected_by=kwargs.get("connected_by"),
        webhook_hook_id=kwargs.get("webhook_hook_id"),
    )
    db.add(repo)
    db.flush()
    return repo


def seed_google_connection(db, user):
    """Google OAuth connection with all integration scopes (Sheets, Gmail, Calendar)."""
    from app.models.calendar import CalendarConnection
    from app.services import google_service
    from app.services.token_vault import seal

    conn = CalendarConnection(
        user_id=user.id,
        provider="google",
        account_email=user.email,
        access_token=seal("test-access-token"),
        refresh_token=seal("test-refresh-token"),
        token_expiry=datetime.now(timezone.utc) + timedelta(hours=2),
        scope=google_service.ALL_SCOPES,
    )
    db.add(conn)
    db.flush()
    return conn
