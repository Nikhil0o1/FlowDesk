import uuid
from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, Index, String, Text
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base, TimestampMixin, UUIDPkMixin

NOTIFICATION_TYPES = (
    "user_onboarded",
    "workspace_invite",
    "space_invite",
    "project_invite",
    "workspace_member_added",
    "workspace_role_changed",
    "workspace_member_removed",
    "project_role_changed",
    "project_team_assigned",
    "team_member_added",
    "team_role_changed",
    "team_member_removed",
    "task_assigned",
    "task_shared",
    "doc_shared",
    "doc_mention",
    "comment_mention",
    "chat_mention",
    "comment_reply",
    "due_date_reminder",
    "task_overdue",
    "sprint_started",
    "sprint_completed",
    "goal_shared",
    "goal_folder_shared",
    "goal_completed",
    "goal_owner_assigned",
    "goal_target_owner_assigned",
    "github_pr_opened",
    "github_pr_merged",
    "github_commit_pushed",
)

# Display order for Customize importance (Important block first, then Not Important).
NOTIFICATION_DISPLAY_ORDER: tuple[str, ...] = (
    "comment_mention",
    "chat_mention",
    "comment_reply",
    "task_assigned",
    "project_team_assigned",
    "task_shared",
    "doc_shared",
    "doc_mention",
    "workspace_invite",
    "space_invite",
    "project_invite",
    "due_date_reminder",
    "task_overdue",
    "workspace_member_added",
    "workspace_role_changed",
    "workspace_member_removed",
    "project_role_changed",
    "team_member_added",
    "team_role_changed",
    "team_member_removed",
    "sprint_started",
    "sprint_completed",
    "goal_shared",
    "goal_folder_shared",
    "goal_completed",
    "goal_owner_assigned",
    "goal_target_owner_assigned",
    "github_pr_opened",
    "github_pr_merged",
    "github_commit_pushed",
    "user_onboarded",
)

# One unique label per type — no duplicated display names.
NOTIFICATION_TYPE_LABELS: dict[str, str] = {
    "user_onboarded": "Welcome / onboarding",
    "workspace_invite": "Workspace invite",
    "space_invite": "Space invite",
    "project_invite": "Project invite",
    "workspace_member_added": "Added to workspace",
    "workspace_role_changed": "Workspace role changed",
    "workspace_member_removed": "Removed from workspace",
    "project_role_changed": "Project role changed",
    "project_team_assigned": "Assigned to my team",
    "team_member_added": "Added to team",
    "team_role_changed": "Team role changed",
    "team_member_removed": "Removed from team",
    "task_assigned": "Assigned to me",
    "task_shared": "Shared with me",
    "doc_shared": "Doc shared with me",
    "doc_mention": "@ Mention in doc",
    "comment_mention": "@ Mentioning me",
    "chat_mention": "@ Mention in chat",
    "comment_reply": "New comments",
    "due_date_reminder": "Due date reminder",
    "task_overdue": "Due date overdue",
    "sprint_started": "Sprint started",
    "sprint_completed": "Sprint completed",
    "goal_shared": "Goal shared with me",
    "goal_folder_shared": "Goal folder shared with me",
    "goal_completed": "Goal completed",
    "goal_owner_assigned": "Goal ownership assigned",
    "goal_target_owner_assigned": "Goal target ownership assigned",
    "github_pr_opened": "GitHub pull request opened",
    "github_pr_merged": "GitHub pull request merged",
    "github_commit_pushed": "GitHub commit pushed",
}

DEFAULT_IMPORTANT_TYPES = frozenset({
    "comment_mention",
    "chat_mention",
    "comment_reply",
    "task_assigned",
    "task_shared",
    "goal_shared",
    "goal_folder_shared",
    "goal_owner_assigned",
    "goal_target_owner_assigned",
    "doc_shared",
    "doc_mention",
    "workspace_invite",
    "space_invite",
    "project_invite",
    "due_date_reminder",
    "task_overdue",
    "project_team_assigned",
})


class Notification(Base, UUIDPkMixin, TimestampMixin):
    __tablename__ = "notifications"
    __table_args__ = (Index("ix_notifications_user_read", "user_id", "read_at"),)

    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), index=True, nullable=False
    )
    type: Mapped[str] = mapped_column(String(40), nullable=False)
    title: Mapped[str] = mapped_column(String(300), nullable=False)
    body: Mapped[str | None] = mapped_column(Text)
    data: Mapped[dict] = mapped_column(JSONB, default=dict, nullable=False)
    read_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    snoozed_until: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    cleared_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    workspace_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("workspaces.id", ondelete="CASCADE")
    )
    project_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("projects.id", ondelete="CASCADE")
    )
