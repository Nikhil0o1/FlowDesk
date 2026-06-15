"""Import all models so Alembic autogenerate and relationship configuration see them."""
from app.models.base import Base  # noqa: F401
from app.models.user import User, Profile, RefreshToken, PasswordResetToken  # noqa: F401
from app.models.organization import Organization, OrganizationMember  # noqa: F401
from app.models.workspace import Workspace, WorkspaceMember  # noqa: F401
from app.models.project import Space, Project, ProjectMember, TaskList  # noqa: F401
from app.models.task import (  # noqa: F401
    CustomStatus,
    Task,
    TaskAssignee,
    TaskDependency,
    TaskAttachment,
    RecurringTask,
)
from app.models.comment import Comment, Mention  # noqa: F401
from app.models.notification import Notification  # noqa: F401
from app.models.activity import ActivityLog  # noqa: F401
from app.models.chat import ChatChannel, ChatMember, ChatMessage, MessageRead  # noqa: F401
from app.models.time_entry import TimeEntry  # noqa: F401
from app.models.sprint import Sprint, SprintTask, StandupUpdate  # noqa: F401
from app.models.invite import Invite  # noqa: F401
from app.models.github import GithubInstallation, GithubRepository, GithubEvent  # noqa: F401
from app.models.audit import AuditLog, CronJobLog  # noqa: F401
from app.models.team import Team, TeamMember  # noqa: F401
from app.models.whiteboard import Whiteboard  # noqa: F401
from app.models.form import Form, FormSubmission  # noqa: F401
from app.models.calendar import CalendarConnection  # noqa: F401
from app.models.integration import GoogleSheetSync  # noqa: F401
