"""Import all models so Alembic autogenerate and relationship configuration see them."""
from app.models.base import Base  # noqa: F401
from app.models.api_token import PersonalAccessToken  # noqa: F401
from app.models.mcp_audit import McpToolInvocation  # noqa: F401
from app.models.integration_oauth import (  # noqa: F401
    IntegrationOAuthApp,
    IntegrationOAuthAuthCode,
    IntegrationOAuthAuthRequest,
)
from app.models.mcp_oauth import (  # noqa: F401
    McpOAuthAuthorizationCode,
    McpOAuthAuthorizationRequest,
    McpOAuthClient,
)
from app.models.user import User, Profile, RefreshToken, LoginOtp, TwoFactorRecoveryCode, RevokedAccessToken  # noqa: F401
from app.models.organization import Organization, OrganizationMember  # noqa: F401
from app.models.workspace import Workspace, WorkspaceMember  # noqa: F401
from app.models.project import Space, SpaceMember, Project, ProjectMember, ProjectTeam, TaskList  # noqa: F401
from app.models.task import (  # noqa: F401
    CustomStatus,
    Task,
    TaskAssignee,
    TaskDependency,
    TaskAttachment,
    RecurringTask,
    TaskShareMember,
    TaskChecklist,
    TaskChecklistItem,
)
from app.models.custom_field import CustomFieldDefinition, CustomFieldValue  # noqa: F401
from app.models.comment import Comment, Mention  # noqa: F401
from app.models.notification import Notification  # noqa: F401
from app.models.inbox import InboxSettings, NotificationTypePreference  # noqa: F401
from app.models.activity import ActivityLog  # noqa: F401
from app.models.chat import ChatChannel, ChatMember, ChatMessage, MessageRead  # noqa: F401
from app.models.time_entry import TimeEntry  # noqa: F401
from app.models.sprint import (  # noqa: F401
    Sprint,
    SprintRetrospective,
    SprintRetrospectiveItem,
    SprintTask,
    StandupUpdate,
)
from app.models.goal import Goal, GoalFolder, GoalFolderShareMember, GoalShareMember, GoalTarget, GoalTargetSprint, GoalTargetTask  # noqa: F401
from app.models.invite import Invite  # noqa: F401
from app.models.github import (  # noqa: F401
    GithubConnection,
    GithubEvent,
    GithubInstallation,
    GithubRepository,
)
from app.models.audit import AuditLog, CronJobLog  # noqa: F401
from app.models.team import Team, TeamMember  # noqa: F401
from app.models.whiteboard import Whiteboard  # noqa: F401
from app.models.document import (  # noqa: F401
    DocFolder,
    Document,
    DocumentActivity,
    DocumentComment,
    DocumentFavorite,
    DocumentRecent,
    DocumentShareMember,
    DocumentTemplate,
    DocumentVersion,
)
from app.models.form import Form, FormSubmission  # noqa: F401
from app.models.calendar import CalendarConnection  # noqa: F401
from app.models.integration import GoogleSheetSync  # noqa: F401
from app.models.template import WorkspaceTemplate  # noqa: F401
from app.models.webhook import WebhookDelivery, WebhookEndpoint  # noqa: F401
from app.models.presence import PresenceEvent, UserPresence, UserSession  # noqa: F401
