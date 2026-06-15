"""Seed demo data: superadmin, demo org, workspaces, projects, tasks, sprint, chat.

Usage:  python seed.py
Idempotent: running twice will not duplicate data.
"""
from datetime import date, datetime, timedelta, timezone

from sqlalchemy import select

from app.core.config import settings
from app.core.security import hash_password
from app.db.base import Base  # noqa: F401  (register models)
from app.db.session import SessionLocal
from app.models.chat import ChatChannel, ChatMember, ChatMessage
from app.models.organization import Organization, OrganizationMember
from app.models.project import Project, ProjectMember, Space, TaskList
from app.models.sprint import Sprint, SprintTask
from app.models.task import CustomStatus, Task, TaskAssignee
from app.models.user import Profile, User
from app.models.workspace import Workspace, WorkspaceMember

DEMO_USERS = [
    # (email, name, password, title)
    ("owner@acme.dev", "Olivia Owner", "Password123!", "Head of Operations"),
    ("admin@acme.dev", "Adam Admin", "Password123!", "Engineering Manager"),
    ("maria@acme.dev", "Maria Member", "Password123!", "Frontend Engineer"),
    ("dev@acme.dev", "Dev Marshall", "Password123!", "Backend Engineer"),
]

DEFAULT_STATUSES = [
    ("To Do", "#87909E", "todo", 0),
    ("In Progress", "#5B9FF0", "in_progress", 1),
    ("In Review", "#B07BE0", "in_progress", 2),
    ("Done", "#4CB782", "done", 3),
]


def get_or_create_user(db, email: str, name: str, password: str, title: str, superadmin=False) -> User:
    user = db.scalar(select(User).where(User.email == email))
    if user:
        return user
    user = User(
        email=email,
        hashed_password=hash_password(password),
        is_active=True,
        is_platform_superadmin=superadmin,
        email_verified_at=datetime.now(timezone.utc),
    )
    db.add(user)
    db.flush()
    db.add(Profile(user_id=user.id, full_name=name, title=title))
    return user


def main() -> None:
    db = SessionLocal()
    try:
        # ---- Platform superadmin (no org memberships, platform scope only) ----
        superadmin = get_or_create_user(
            db, settings.SUPERADMIN_EMAIL, "Platform Admin",
            settings.SUPERADMIN_PASSWORD, "Platform Administrator", superadmin=True,
        )
        # Keep the bootstrap account in sync with .env even if it already exists
        # (get_or_create_user never touches existing rows).
        superadmin.hashed_password = hash_password(settings.SUPERADMIN_PASSWORD)
        superadmin.is_platform_superadmin = True
        superadmin.is_active = True

        # ---- Demo organization ----
        org = db.scalar(select(Organization).where(Organization.slug == "acme"))
        if not org:
            org = Organization(name="Acme Inc", slug="acme", plan="business", seats=25)
            db.add(org)
            db.flush()

        owner = get_or_create_user(db, *DEMO_USERS[0])
        admin = get_or_create_user(db, *DEMO_USERS[1])
        maria = get_or_create_user(db, *DEMO_USERS[2])
        dev = get_or_create_user(db, *DEMO_USERS[3])

        def ensure_org_member(user, role):
            if not db.scalar(select(OrganizationMember).where(
                OrganizationMember.organization_id == org.id,
                OrganizationMember.user_id == user.id,
            )):
                db.add(OrganizationMember(
                    organization_id=org.id, user_id=user.id, role=role,
                    joined_at=datetime.now(timezone.utc),
                ))

        ensure_org_member(owner, "owner")
        ensure_org_member(admin, "member")
        ensure_org_member(maria, "member")
        ensure_org_member(dev, "member")

        # ---- Workspace ----
        workspace = db.scalar(select(Workspace).where(
            Workspace.organization_id == org.id, Workspace.name == "Product Engineering"
        ))
        if not workspace:
            workspace = Workspace(
                organization_id=org.id, name="Product Engineering",
                description="Everything we build and ship", color="#8C5BFF",
                created_by=owner.id,
            )
            db.add(workspace)
            db.flush()

        def ensure_ws_member(user, role):
            if not db.scalar(select(WorkspaceMember).where(
                WorkspaceMember.workspace_id == workspace.id,
                WorkspaceMember.user_id == user.id,
            )):
                db.add(WorkspaceMember(workspace_id=workspace.id, user_id=user.id, role=role))

        ensure_ws_member(owner, "admin")
        ensure_ws_member(admin, "admin")
        ensure_ws_member(maria, "member")
        ensure_ws_member(dev, "member")

        # ---- Space + projects ----
        space = db.scalar(select(Space).where(
            Space.workspace_id == workspace.id, Space.name == "Team Space"
        ))
        if not space:
            space = Space(workspace_id=workspace.id, name="Team Space", color="#4F8BFF",
                          created_by=owner.id)
            db.add(space)
            db.flush()

        def ensure_project(name, key, color, members):
            project = db.scalar(select(Project).where(
                Project.workspace_id == workspace.id, Project.key == key
            ))
            if project:
                return project
            project = Project(
                space_id=space.id, workspace_id=workspace.id, name=name, key=key,
                color=color, created_by=admin.id,
            )
            db.add(project)
            db.flush()
            for i, (sname, scolor, scat, spos) in enumerate(DEFAULT_STATUSES):
                db.add(CustomStatus(project_id=project.id, name=sname, color=scolor,
                                    category=scat, position=spos))
            db.add(TaskList(project_id=project.id, name="Tasks", position=0, created_by=admin.id))
            for user, role in members:
                db.add(ProjectMember(project_id=project.id, user_id=user.id, role=role))
            return project

        project1 = ensure_project("Project Phoenix", "PHX", "#9B59B6",
                                  [(admin, "admin"), (maria, "member"), (dev, "member")])
        project2 = ensure_project("Mobile App", "MOB", "#E67E22",
                                  [(admin, "admin"), (dev, "member")])
        db.flush()

        # ---- Tasks ----
        existing_tasks = db.scalar(select(Task).where(Task.project_id == project1.id))
        if not existing_tasks:
            statuses = {
                s.name: s for s in db.scalars(
                    select(CustomStatus).where(CustomStatus.project_id == project1.id)
                ).all()
            }
            task_list = db.scalar(select(TaskList).where(TaskList.project_id == project1.id))
            demo_tasks = [
                ("Design new onboarding flow", "story", "high", "To Do", 5, maria, 2),
                ("Fix login redirect loop", "bug", "urgent", "In Progress", 2, dev, 1),
                ("Implement realtime notifications", "task", "high", "In Progress", 8, dev, 5),
                ("Refactor billing service", "task", "normal", "To Do", 3, None, 7),
                ("Q3 platform epic", "epic", "normal", "To Do", 13, None, 30),
                ("Update API documentation", "task", "low", "Done", 1, maria, -1),
                ("Add dark mode support", "story", "normal", "In Review", 5, maria, 3),
                ("Optimize database queries", "task", "high", "To Do", 3, dev, 4),
            ]
            number = project1.next_task_number
            for i, (title, ttype, priority, status_name, points, assignee, due_days) in enumerate(demo_tasks):
                task = Task(
                    project_id=project1.id,
                    list_id=task_list.id,
                    number=number,
                    title=title,
                    description=f"Demo task: {title}.",
                    priority=priority,
                    status_id=statuses[status_name].id,
                    task_type=ttype,
                    story_points=points,
                    due_date=date.today() + timedelta(days=due_days),
                    position=(i + 1) * 1024,
                    labels=["frontend"] if assignee is maria else ["backend"] if assignee is dev else [],
                    created_by=admin.id,
                    completed_at=datetime.now(timezone.utc) if status_name == "Done" else None,
                )
                db.add(task)
                db.flush()
                if assignee:
                    db.add(TaskAssignee(task_id=task.id, user_id=assignee.id, assigned_by=admin.id))
                number += 1
            project1.next_task_number = number

        # ---- Sprint ----
        sprint = db.scalar(select(Sprint).where(Sprint.workspace_id == workspace.id))
        if not sprint:
            sprint = Sprint(
                workspace_id=workspace.id, project_id=project1.id,
                name="Sprint 1", goal="Ship onboarding + realtime foundations",
                start_date=date.today() - timedelta(days=3),
                end_date=date.today() + timedelta(days=11),
                status="active", scrum_master_id=admin.id,
                started_at=datetime.now(timezone.utc), created_by=admin.id,
            )
            db.add(sprint)
            db.flush()
            sprint_tasks = db.scalars(
                select(Task).where(Task.project_id == project1.id).limit(5)
            ).all()
            for t in sprint_tasks:
                db.add(SprintTask(sprint_id=sprint.id, task_id=t.id, added_by=admin.id))

        # ---- Chat ----
        channel = db.scalar(select(ChatChannel).where(
            ChatChannel.workspace_id == workspace.id, ChatChannel.name == "general"
        ))
        if not channel:
            channel = ChatChannel(workspace_id=workspace.id, name="general",
                                  description="Team-wide announcements and chat",
                                  created_by=owner.id)
            db.add(channel)
            db.flush()
        for user in (owner, admin, maria, dev):
            if not db.scalar(select(ChatMember).where(
                ChatMember.channel_id == channel.id, ChatMember.user_id == user.id
            )):
                db.add(ChatMember(channel_id=channel.id, user_id=user.id,
                                  role="admin" if user is owner else "member"))
        if not db.scalar(select(ChatMessage).where(ChatMessage.channel_id == channel.id)):
            db.add(ChatMessage(channel_id=channel.id, author_id=owner.id,
                               body="Welcome to #general! 🎉 This is where the team hangs out."))
            db.add(ChatMessage(channel_id=channel.id, author_id=admin.id,
                               body="Sprint 1 is live — check the board for your tasks."))

        db.commit()
        print("Seed complete.")
        print(f"  Superadmin:  {settings.SUPERADMIN_EMAIL} / {settings.SUPERADMIN_PASSWORD}")
        for email, name, password, _ in DEMO_USERS:
            print(f"  {name:<14} {email} / {password}")
    finally:
        db.close()


if __name__ == "__main__":
    main()
