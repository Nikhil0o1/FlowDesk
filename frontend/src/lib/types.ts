export interface UserBrief {
  id: string
  email: string
  full_name: string
  avatar_url: string | null
  avatar_color?: string | null
}

export interface Profile {
  full_name: string
  avatar_url: string | null
  avatar_color: string | null
  status_text: string | null
  title: string | null
  timezone: string
  phone: string | null
  about: string | null
}

export interface User {
  id: string
  email: string
  is_active: boolean
  is_platform_superadmin: boolean
  auth_provider: string
  last_login_at: string | null
  created_at: string
  totp_enabled: boolean
  profile: Profile | null
}

export interface TokenResponse {
  access_token: string
  token_type: string
  expires_in: number
  user: User
  login_context: LoginContext
  refresh_token?: string | null
}

/** Result of POST /auth/otp/verify. When 2FA applies, no session is issued yet
 * and a short-lived challenge_token drives the /auth/2fa/* step. */
export interface OtpVerifyResponse {
  status: 'authenticated' | 'totp_required' | 'totp_enrollment_required'
  challenge_token: string | null
  access_token: string | null
  token_type: string
  expires_in: number | null
  user: User | null
  login_context: LoginContext | null
  refresh_token?: string | null
}

export interface TotpSetupResponse {
  secret: string
  otpauth_uri: string
}

export interface Totp2faStatus {
  enrolled: boolean
  org_required: boolean
  recovery_codes_remaining: number
}

/** POST /auth/2fa/confirm — session + the one-time recovery codes to show once. */
export interface Login2faEnrollResponse extends TokenResponse {
  recovery_codes: string[]
}

export interface MeResponse {
  user: User
  login_context: LoginContext
}

export interface LoginContext {
  kind: 'platform_superadmin' | 'org_owner' | 'workspace_admin' | 'member' | 'pending_invite'
  role: string
  redirect_to: string
  organization_id: string | null
  workspace_id: string | null
  project_id: string | null
}

export interface Page<T> {
  items: T[]
  total: number
  page: number
  page_size: number
}

export interface Organization {
  id: string
  name: string
  logo_url: string | null
  is_disabled: boolean
  require_2fa: boolean
  created_at: string
  my_role: string | null
}

export interface Workspace {
  id: string
  organization_id: string
  name: string
  description: string | null
  color: string
  icon: string | null
  is_archived: boolean
  created_at: string
  my_role: string | null
}

export interface Space {
  id: string
  workspace_id: string
  name: string
  color: string
  icon: string | null
  position: number
  created_at: string
  my_role: 'owner' | 'admin' | 'member' | null
}

export interface SpaceMember {
  id: string
  space_id: string
  user_id: string
  role: 'admin' | 'member'
  created_at: string
  user: UserBrief | null
}

export interface Project {
  id: string
  space_id: string | null
  workspace_id: string
  name: string
  description: string | null
  color: string
  icon: string | null
  position: number
  is_archived: boolean
  is_personal?: boolean
  personal_owner_id?: string | null
  created_at: string
  my_role: string | null
  my_explicit_role?: string | null
  task_count: number | null
  done_task_count: number | null
}

export interface MyTasksSummary {
  today: number
  overdue: number
  today_and_overdue: number
  next: number
  unscheduled: number
}

export interface CalendarProviderStatus {
  configured: boolean
  connected: boolean
  account_email: string | null
}

export interface CalendarStatus {
  google: CalendarProviderStatus
  outlook: CalendarProviderStatus
}

export interface CalendarEvent {
  id: string
  summary: string
  start: string
  end: string
  all_day: boolean
  link: string | null
  meet_link?: string | null
}

export interface StatusCount {
  name: string
  color: string
  count: number
}

export interface WorkspaceTaskStats {
  total: number
  by_status: StatusCount[]
}

export interface TaskList {
  id: string
  project_id: string
  name: string
  position: number
  created_at: string
}

export interface CustomStatus {
  id: string
  project_id: string
  name: string
  color: string
  category: 'todo' | 'in_progress' | 'done' | 'cancelled'
  position: number
}

export type Priority = 'urgent' | 'high' | 'normal' | 'low'
export type TaskType = 'task' | 'bug' | 'story' | 'epic'

export interface Task {
  id: string
  project_id: string
  list_id: string | null
  parent_task_id: string | null
  number: number
  ref: string
  title: string
  description: string | null
  priority: Priority | null
  task_type: TaskType
  start_date: string | null
  due_date: string | null
  planned_start_at: string | null
  planned_end_at: string | null
  google_calendar_event_id: string | null
  story_points: number | null
  position: number
  labels: string[]
  is_archived: boolean
  completed_at: string | null
  created_by: string | null
  created_at: string
  updated_at: string
  status: CustomStatus | null
  assignees: UserBrief[]
  subtask_count: number
  subtask_done_count: number
  comment_count: number
  github_issue_number: number | null
  github_issue_url: string | null
  time_estimate_seconds: number | null
  is_private: boolean
}

export interface TaskDependency {
  id: string
  task_id: string
  depends_on_task_id: string
  depends_on: Task | null
}

export interface Attachment {
  id: string
  task_id: string
  file_name: string
  mime_type: string
  size_bytes: number
  uploaded_by: string | null
  created_at: string
  uploader: UserBrief | null
}

export interface ChecklistItem {
  id: string
  content: string
  is_done: boolean
  position: number
}

export interface Checklist {
  id: string
  name: string
  position: number
  items: ChecklistItem[]
}

export interface CustomFieldValue {
  field_id: string
  value: { v?: unknown }
}

export interface TaskDetail extends Task {
  subtasks: Task[]
  dependencies: TaskDependency[]
  dependents: TaskDependency[]
  attachments: Attachment[]
  total_tracked_seconds: number
  checklists: Checklist[]
  custom_fields: CustomFieldValue[]
}

export type CustomFieldType = 'text' | 'number' | 'date' | 'select' | 'checkbox'

export interface CustomFieldDef {
  id: string
  project_id: string
  name: string
  field_type: CustomFieldType
  options: string[]
  position: number
}

export interface TaskShareMember {
  user_id: string
  role: 'editor' | 'viewer'
  user: UserBrief | null
}

export interface TaskShareState {
  is_private: boolean
  public_enabled: boolean
  public_token: string | null
  public_url: string | null
  public_expires_at: string | null
  public_searchable: boolean
  members: TaskShareMember[]
}

export interface Comment {
  id: string
  task_id: string
  author_id: string
  parent_comment_id: string | null
  body: string
  github_comment_id: number | null
  github_author_login: string | null
  created_at: string
  updated_at: string
  author: UserBrief | null
  reply_count: number
}

export interface AppNotification {
  id: string
  type: string
  title: string
  body: string | null
  data: Record<string, unknown>
  read_at: string | null
  snoozed_until?: string | null
  cleared_at?: string | null
  important?: boolean
  workspace_id: string | null
  project_id: string | null
  created_at: string
}

export type InboxTab = 'primary' | 'other' | 'later' | 'cleared' | 'all'
export type InboxFilter = 'mentions' | 'assigned' | 'unread' | 'reminders'

export interface InboxSettings {
  show_all_tab: boolean
  group_by_date: boolean
  sort_newest_first: boolean
  display_mode: 'fullscreen' | 'inline'
  email_notifications_enabled: boolean
  browser_notifications_enabled: boolean
  auto_follow_tasks: boolean
}

export interface NotificationTypePreference {
  type: string
  label: string
  important: boolean
  section: 'important' | 'not_important'
}

export interface NotificationPreferences {
  items: NotificationTypePreference[]
  important_count: number
  total_count: number
}

export interface InboxSummary {
  mentions: number
  assigned_to_me: number
  unread: number
  reminders: number
}

export interface Channel {
  id: string
  workspace_id: string
  project_id: string | null
  name: string
  description: string | null
  is_private: boolean
  is_direct: boolean
  is_general?: boolean
  created_at: string
  member_count: number
  unread_count: number
  last_message_at: string | null
}

export interface ChatAttachment {
  id: string
  channel_id: string
  message_id: string | null
  file_name: string
  mime_type: string
  size_bytes: number
  created_at: string
}

export interface ChatMessage {
  id: string
  channel_id: string
  author_id: string
  parent_message_id: string | null
  body: string
  edited_at: string | null
  created_at: string
  author: UserBrief | null
  attachments?: ChatAttachment[]
}

export interface TimeEntry {
  id: string
  task_id: string
  user_id: string
  started_at: string
  ended_at: string | null
  duration_seconds: number | null
  description: string | null
  is_manual: boolean
  stopped_by_system: boolean
  created_at: string
  user: UserBrief | null
  task_title: string | null
  task_ref: string | null
}

export interface Sprint {
  id: string
  workspace_id: string
  project_id: string | null
  name: string
  goal: string | null
  start_date: string | null
  end_date: string | null
  status: 'planned' | 'active' | 'completed'
  scrum_master_id: string | null
  started_at: string | null
  completed_at: string | null
  created_at: string
  scrum_master: UserBrief | null
  task_count: number
  total_points: number
  completed_points: number
}

export type GoalStatus = 'draft' | 'active' | 'completed' | 'archived'
export type GoalTargetType = 'tasks' | 'number' | 'currency' | 'true_false'

export interface Goal {
  id: string
  workspace_id: string
  name: string
  description: string | null
  owner_id: string
  status: GoalStatus
  progress: string | number
  start_date: string | null
  due_date: string | null
  is_private: boolean
  share_token: string | null
  color: string | null
  folder_id: string | null
  created_by: string | null
  created_at: string
  updated_at: string
  display_order?: number
  owner: UserBrief | null
  owners?: UserBrief[]
  created_by_user: UserBrief | null
  target_count: number
}

export interface GoalTarget {
  id: string
  goal_id: string
  title: string
  owner_id: string | null
  target_type: GoalTargetType
  start_value: string | number | null
  target_value: string | number | null
  current_value: string | number | null
  is_completed: boolean
  progress: string | number
  display_order: number
  created_at: string
  updated_at: string
  linked_task_count: number
  owner: UserBrief | null
  owners?: UserBrief[]
}

export interface GoalDetail extends Goal {
  targets: GoalTarget[]
}

export interface GoalTargetProgress {
  id: string
  title: string
  progress: string | number
  target_type?: GoalTargetType
  linked_task_count: number
}

export interface GoalProgress {
  goal_id: string
  progress: string | number
  targets: GoalTargetProgress[]
}

export interface GoalShareMember {
  user_id: string
  role: 'editor' | 'viewer'
  user: UserBrief | null
}

export interface GoalShareState {
  goal_id: string
  is_private: boolean
  share_token: string | null
  share_url: string | null
  workspace_shared: boolean
  members: GoalShareMember[]
}

export interface GoalFolderShareState {
  folder_id: string
  is_private: boolean
  members: GoalShareMember[]
}

export interface GoalAccess {
  section_access: boolean
  explicit_access: boolean
  can_access: boolean
}

export interface GoalFolder {
  id: string
  workspace_id: string
  name: string
  description: string | null
  color: string | null
  is_private: boolean
  is_archived: boolean
  archived_at: string | null
  created_by: string | null
  created_at: string
  updated_at: string
  goal_count: number
  progress: string | number
  active_count: number
  completed_count: number
  archived_count: number
  draft_count: number
  created_by_user: UserBrief | null
}

export interface GoalFolderDetail extends GoalFolder {
  goals: Goal[]
}

export interface GoalFolderAnalytics {
  folder_id: string
  name: string
  progress: string | number
  goal_count: number
  active_count: number
  completed_count: number
  archived_count: number
  draft_count: number
  tracked_goal_count: number
  not_started_count: number
  in_progress_count: number
  at_risk_count: number
}

export interface GoalTaskLink {
  task_id: string
  goal_id: string
  goal_name: string
  target_id: string
  target_title: string
}

export interface BurndownPoint {
  day: string
  remaining_points: number
  ideal_points: number
}

export interface SprintBurndown {
  sprint_id: string
  total_points: number
  completed_points: number
  points: BurndownPoint[]
}

export interface Standup {
  id: string
  sprint_id: string
  user_id: string
  for_date: string
  yesterday: string | null
  today: string | null
  blockers: string | null
  created_at: string
  user: UserBrief | null
}

export type RetrospectiveItemCategory = 'rose' | 'thorn' | 'bud'

export interface SprintSummary {
  sprint_id: string
  sprint_name: string
  total_tasks: number
  completed_tasks: number
  incomplete_tasks: number
  total_points: number
  completed_points: number
  scope_changes: number
  open_blockers: number
  resolved_blockers: number
  incomplete_task_refs: string[]
  pace: string
}

export interface RetrospectiveItem {
  id: string
  retrospective_id: string
  category: RetrospectiveItemCategory
  body: string
  author_id: string
  is_done: boolean
  assignee_id: string | null
  created_at: string
  updated_at: string
  author: UserBrief | null
  assignee: UserBrief | null
}

export interface SprintRetrospective {
  id: string
  sprint_id: string
  stage_notes: string | null
  created_at: string
  updated_at: string
  items: RetrospectiveItem[]
  summary: SprintSummary | null
}

export interface OrgMember {
  id: string
  user_id: string
  role: string
  created_at: string
  user: UserBrief | null
}

export interface WorkspaceMembershipBrief {
  workspace_id: string
  workspace_name: string
  role: string
}

export interface SpaceMembershipBrief {
  space_id: string
  space_name: string
  role: string
}

export interface ProjectMembershipBrief {
  project_id: string
  project_name: string
  space_id: string
  role: string
}

export interface WorkspaceMemberCandidate {
  user_id: string
  user: UserBrief | null
  org_role: string
  workspaces: WorkspaceMembershipBrief[]
  spaces: SpaceMembershipBrief[]
  projects: ProjectMembershipBrief[]
}

export interface WorkspaceAccessItem {
  workspace_id: string
  workspace_name: string
  role: string | null
}

export interface SpaceAccessItem {
  space_id: string
  space_name: string
  workspace_id: string
  workspace_name: string
  role: string | null
}

export interface ProjectAccessItem {
  project_id: string
  project_name: string
  workspace_id: string
  workspace_name: string
  space_id: string | null
  space_name: string | null
  role: string | null
}

export interface MemberAccessDetail {
  user_id: string
  org_role: string
  highest_role: string
  user: UserBrief | null
  workspace_access: WorkspaceAccessItem[]
  space_access: SpaceAccessItem[]
  project_access: ProjectAccessItem[]
  can_manage_org_role: boolean
}

export interface Invite {
  id: string
  email: string
  scope: string
  role: string
  status: string
  expires_at: string
  created_at: string
}

export interface InvitePreview {
  email: string
  scope: string
  role: string
  organization_name: string
  target_name: string
  existing_user: boolean
  expired: boolean
}

export interface InviteContext {
  scope: 'organization' | 'workspace' | 'space' | 'project'
  organization_id: string
  workspace_id: string | null
  space_id: string | null
  project_id: string | null
}

export interface Activity {
  id: string
  workspace_id: string
  project_id: string | null
  task_id: string | null
  actor_id: string | null
  action: string
  data: Record<string, any>
  created_at: string
  actor: UserBrief | null
}

export interface GithubEvent {
  id: string
  repository_id: string
  event_type: string
  action: string | null
  actor_login: string | null
  payload: { summary?: string; url?: string; repo?: string; [k: string]: unknown }
  task_id: string | null
  created_at: string
}

export interface SearchResults {
  tasks: Task[]
  projects: Project[]
  comments: { comment_id: string; task_id: string; task_title: string; excerpt: string; author: UserBrief | null }[]
  users: UserBrief[]
  goals: Goal[]
  goal_folders: GoalFolder[]
}

export interface OrgMetadata {
  id: string
  name: string
  is_disabled: boolean
  created_at: string
  member_count: number
  workspace_count: number
  project_count: number
  task_count: number
}

export interface PlatformStats {
  organizations: number
  active_organizations: number
  users: number
  workspaces: number
}

export interface AuditLog {
  id: string
  action: string
  actor_id: string | null
  target_type: string | null
  target_id: string | null
  data: Record<string, unknown>
  created_at: string
  actor: UserBrief | null
}

export interface ProjectTeam {
  id: string
  project_id: string
  team_id: string
  team_name: string
  team_color: string
  default_role: string
  member_count: number
  assigned_by: string | null
  created_at: string
}

export interface ProjectTeamAssignResult {
  team_id: string
  team_name: string
  members_added: number
  members_skipped: number
  members_ineligible: number
  assignment: ProjectTeam
}

export interface TeamMember {
  id: string
  user_id: string
  role: 'admin' | 'member'
  created_at: string
  user: UserBrief | null
}

export interface Team {
  id: string
  workspace_id: string
  name: string
  description: string | null
  color: string
  created_by: string | null
  created_at: string
  members: UserBrief[]
  member_details: TeamMember[]
  my_role: 'owner' | 'admin' | 'member' | null
  can_manage_members: boolean
  can_delete: boolean
  can_create_teams: boolean
}

/** Excalidraw scene as persisted in Whiteboard.content (loosely typed here). */
export interface WhiteboardScene {
  elements?: unknown[]
  appState?: Record<string, unknown>
  files?: Record<string, unknown>
}

export interface Whiteboard {
  id: string
  workspace_id: string
  project_id: string | null
  project_name?: string | null
  name: string
  created_by: string | null
  created_at: string
  updated_at: string
  element_count: number
  creator: UserBrief | null
  can_delete?: boolean
  content?: WhiteboardScene
}

export type FormFieldType = 'text' | 'textarea' | 'select' | 'date' | 'email' | 'checklist'

export interface FormField {
  id: string
  type: FormFieldType
  label: string
  required: boolean
  options?: string[]
}

export interface FormDef {
  id: string
  workspace_id: string
  project_id: string
  name: string
  description: string | null
  fields: FormField[]
  public_token: string
  is_active: boolean
  created_by: string | null
  created_at: string
  updated_at: string
  submission_count: number
  project_name: string | null
}

export interface FormSubmission {
  id: string
  form_id: string
  task_id: string | null
  data: Record<string, string>
  submitter_email: string | null
  created_at: string
  task_ref: string | null
}

export interface PublicForm {
  name: string
  description: string | null
  fields: FormField[]
  workspace_name: string
  is_active: boolean
}

export interface CronJobLog {
  id: string
  job_name: string
  started_at: string
  finished_at: string | null
  status: string
  items_processed: number
  message: string | null
}

// ---------------------------------------------------------------------------
// Dashboard types (role-based)
// ---------------------------------------------------------------------------

export interface DashboardTrend {
  label: string
  direction: 'up' | 'down' | 'flat'
  tone: 'positive' | 'negative' | 'neutral'
}

export interface DashboardKpis {
  active_projects: number
  organization_members: number
  teams: number
  active_sprints: number
  overdue_tasks: number
  completion_percent: number
  workspaces: number
  trends: Record<string, DashboardTrend>
}

export interface ProjectProgressRow {
  project_id: string
  name: string
  color: string
  progress_percent: number
}

export interface TeamWorkloadRow {
  team_id: string
  name: string
  color: string
  member_count: number
  open_tasks: number
  overdue_tasks: number
  completed_tasks: number
}

export interface TeamProductivityRow {
  team_id: string
  name: string
  completed_count: number
}

export interface TeamProductivitySeries {
  key: string
  team_id: string | null
  name: string
  color: string
}

export interface TeamProductivityTrendPoint {
  day: string
  label: string
  counts: Record<string, number>
}

export interface TeamProductivitySummary {
  total_completed: number
  previous_period_total: number
  active_teams: number
  leading_team_name: string | null
  leading_team_count: number
  display_mode: 'team' | 'workspace'
  total_teams: number
  total_entities: number
  featured_count: number
  other_entities_count: number
}

export interface DeliveryVelocityTrendPoint {
  day: string
  label: string
  completed_count: number
}

export interface DeliveryVelocitySummary {
  total_completed: number
  previous_period_total: number
  daily_average: number
  best_day_label: string | null
  best_day_count: number
}

export interface CriticalTaskRow {
  task_id: string
  title: string
  project_id: string
  project_name: string
  task_ref: string
  assignee: UserBrief | null
  due_date: string | null
  status_name: string
  status_color: string
  status_kind: string
}

export interface DashboardActivityRow {
  id: string
  action: string
  summary: string
  actor: UserBrief | null
  project_name: string | null
  created_at: string
}

export interface ProjectPortfolioRow {
  project_id: string
  name: string
  color: string
  progress_percent: number
  active_sprint: string | null
  task_count: number
  overdue_count: number
  health: 'healthy' | 'at_risk'
}

export interface OrgDashboard {
  organization_id: string
  organization_name: string
  kpis: DashboardKpis
  project_progress: ProjectProgressRow[]
  project_progress_total: number
  task_status_total: number
  task_status_breakdown: StatusCount[]
  team_workload: TeamWorkloadRow[]
  team_workload_total: number
  team_productivity: TeamProductivityRow[]
  team_productivity_total: number
  team_productivity_series: TeamProductivitySeries[]
  team_productivity_trend: TeamProductivityTrendPoint[]
  team_productivity_summary: TeamProductivitySummary | null
  delivery_velocity_trend: DeliveryVelocityTrendPoint[]
  delivery_velocity_summary: DeliveryVelocitySummary | null
  critical_tasks: CriticalTaskRow[]
  critical_tasks_total: number
  recent_activities: DashboardActivityRow[]
  project_portfolio: ProjectPortfolioRow[]
}

export interface MemberWorkloadRow {
  user: UserBrief
  open_tasks: number
  completed_tasks: number
}

export interface SprintSummaryRow {
  sprint_id: string
  name: string
  status: string
  task_count: number
  completed_tasks: number
  total_points: number
  completed_points: number
  start_date: string | null
  end_date: string | null
}

export interface SpaceOverviewRow {
  space_id: string
  name: string
  color: string
  project_count: number
  task_count: number
  done_count: number
}

export interface WorkspaceDashboardKpis {
  total_tasks: number
  open_tasks: number
  completed_tasks: number
  overdue_tasks: number
  completion_percent: number
  spaces: number
  projects: number
  members: number
  active_sprints: number
  trends: Record<string, DashboardTrend>
}

export interface WorkspaceDashboard {
  workspace_id: string
  workspace_name: string
  kpis: WorkspaceDashboardKpis
  space_overview: SpaceOverviewRow[]
  task_status_breakdown: StatusCount[]
  task_status_total: number
  project_progress: ProjectProgressRow[]
  project_progress_total: number
  member_workload: MemberWorkloadRow[]
  active_sprints: SprintSummaryRow[]
  critical_tasks: CriticalTaskRow[]
  critical_tasks_total: number
  recent_activities: DashboardActivityRow[]
}

export interface SpaceDashboardKpis {
  total_tasks: number
  open_tasks: number
  completed_tasks: number
  overdue_tasks: number
  completion_percent: number
  projects: number
  members: number
  trends: Record<string, DashboardTrend>
}

export interface SpaceDashboard {
  space_id: string
  space_name: string
  workspace_name: string
  kpis: SpaceDashboardKpis
  project_progress: ProjectProgressRow[]
  project_progress_total: number
  task_status_breakdown: StatusCount[]
  task_status_total: number
  member_workload: MemberWorkloadRow[]
  critical_tasks: CriticalTaskRow[]
  critical_tasks_total: number
  recent_activities: DashboardActivityRow[]
}

export interface ProjectDashboardKpis {
  total_tasks: number
  open_tasks: number
  completed_tasks: number
  overdue_tasks: number
  completion_percent: number
  sprint_velocity: number
  projects: number
  members: number
  trends: Record<string, DashboardTrend>
}

export interface ProjectDashboard {
  project_id: string
  project_name: string
  project_color: string
  space_name: string | null
  kpis: ProjectDashboardKpis
  task_status_breakdown: StatusCount[]
  task_status_total: number
  member_workload: MemberWorkloadRow[]
  active_sprints: SprintSummaryRow[]
  critical_tasks: CriticalTaskRow[]
  critical_tasks_total: number
  recent_activities: DashboardActivityRow[]
}

export interface ProjectMemberDashboardKpis {
  my_open_tasks: number
  my_overdue: number
  my_due_today: number
  my_due_this_week: number
  my_completed_this_week: number
  project_completion_percent: number
  active_sprint_count: number
  trends: Record<string, DashboardTrend>
}

export interface ProjectMemberDashboard {
  project_id: string
  project_name: string
  project_color: string
  space_name: string | null
  my_role: string
  kpis: ProjectMemberDashboardKpis
  my_task_status_breakdown: StatusCount[]
  my_task_status_total: number
  my_attention_tasks: CriticalTaskRow[]
  my_attention_total: number
  active_sprints: SprintSummaryRow[]
  recent_activities: DashboardActivityRow[]
}

// ---------------------------------------------------------------------------
// User role summary
// ---------------------------------------------------------------------------

export type HighestRole =
  | 'org_owner'
  | 'org_admin'
  | 'org_member'
  | 'workspace_admin'
  | 'space_admin'
  | 'project_admin'
  | 'project_member'
  | 'project_viewer'
  | 'member'

export interface WorkspaceRoleItem {
  workspace_id: string
  workspace_name: string
  role: string
}

export interface SpaceRoleItem {
  space_id: string
  space_name: string
  workspace_id: string
  workspace_name: string
  role: string
}

export interface ProjectRoleItem {
  project_id: string
  project_name: string
  space_id?: string | null
  space_name: string | null
  workspace_id: string
  role: string
  /** Personal List projects — ignore for Goals / Analytics / scoped-admin elevation. */
  is_personal?: boolean
}

export interface UserRoleSummary {
  highest_role: HighestRole
  org_role: string | null
  org_name: string | null
  workspace_roles: WorkspaceRoleItem[]
  space_roles: SpaceRoleItem[]
  project_roles: ProjectRoleItem[]
}

/* ---------------- Analytics (presence) ---------------- */

export type PresenceStatus = 'online' | 'away' | 'busy' | 'offline'

export interface AnalyticsOverview {
  total_members: number
  online: number
  offline: number
  busy: number
  away: number
  average_session_duration: number
  active_users_today: number
}

export interface AnalyticsTimelinePoint {
  bucket: string
  online: number
}

export interface AnalyticsTimeline {
  date: string
  timezone?: string
  points: AnalyticsTimelinePoint[]
}

export interface AnalyticsStatusSlice {
  status: PresenceStatus
  count: number
}

export interface AnalyticsStatusDistribution {
  total: number
  slices: AnalyticsStatusSlice[]
}

export interface PresenceUserRow {
  user: UserBrief
  status: PresenceStatus
  role: string | null
  teams: string[]
  workspaces: string[]
  login_time: string | null
  last_seen: string | null
  session_duration: number | null
  idle_time: number | null
  device: string | null
  browser: string | null
}

export interface PresenceUsersPage {
  items: PresenceUserRow[]
  total: number
  page: number
  page_size: number
}

export interface PresenceActivityItem {
  id: string
  user: UserBrief | null
  event_type: string
  old_status: string | null
  new_status: string | null
  created_at: string
}

export interface TeamActivityRow {
  id: string
  name: string
  color: string | null
  member_count: number
  online: number
  busy: number
  away: number
  offline: number
  active_today: number
}

export interface TeamActivityGroup {
  group_by: string
  rows: TeamActivityRow[]
}

export interface PresenceSessionInfo {
  id: string
  login_time: string
  logout_time: string | null
  last_activity: string | null
  duration: number
  device: string | null
  browser: string | null
  ip_address: string | null
  active: boolean
}

export interface WeeklyActivityDay {
  date: string
  session_count: number
  total_seconds: number
}

export interface StatusTimelineItem {
  event_type: string
  old_status: string | null
  new_status: string | null
  created_at: string
}

export interface UserPresenceDetail {
  row: PresenceUserRow
  title: string | null
  timezone: string | null
  current_session: PresenceSessionInfo | null
  recent_sessions: PresenceSessionInfo[]
  weekly_activity: WeeklyActivityDay[]
  status_timeline: StatusTimelineItem[]
}

/* ---------------- Analytics Phase 3 ---------------- */

export interface TrendPoint {
  date: string
  active_users: number
  peak_online: number
  total_sessions: number
  avg_session_duration: number
}

export interface AnalyticsTrends {
  days: number
  timezone?: string
  points: TrendPoint[]
  peak_online: number
  avg_active_users: number
  growth: string
}

export interface HeatmapCell {
  weekday: number
  hour: number
  value: number
}

export interface AnalyticsHeatmap {
  days: number
  max_value: number
  cells: HeatmapCell[]
}

export interface ContributionDay {
  date: string
  count: number
}

export interface AnalyticsContributionHeatmap {
  days: number
  timezone?: string
  max_count: number
  points: ContributionDay[]
}

export interface DeviceSlice {
  name: string
  sessions: number
  users: number
}

export interface DeviceAnalytics {
  days: number
  total_sessions: number
  devices: DeviceSlice[]
  browsers: DeviceSlice[]
}

export type AnalyticsAlertLevel = 'info' | 'warning' | 'critical'

export interface AnalyticsAlert {
  id: string
  level: AnalyticsAlertLevel
  title: string
  description: string
  count: number
}

export interface AnalyticsAlerts {
  generated_at: string
  alerts: AnalyticsAlert[]
}

/* ---------------- My Analytics (personal) ---------------- */

export interface MyAnalyticsOverview {
  tasks_completed: number
  completion_rate: number
  avg_completion_time: number
  on_time_delivery: number
  productivity_streak: number
}

export interface MyMonthlySummary {
  month: string
  completed_tasks: number
  projects_worked: number
  comments: number
  attachments: number
  late_tasks: number
}

export interface MyAnalyticsOverviewResponse {
  overview: MyAnalyticsOverview
  monthly_summary: MyMonthlySummary
}

export interface MyTrendPoint {
  date: string
  value: number
}

export interface MyProductivityTrend {
  period: string
  points: MyTrendPoint[]
  total: number
  average: number
}

export interface MyTaskTrendDay {
  date: string
  weekday: string
  completed: number
}

export interface MyTaskTrends {
  week_start: string
  points: MyTaskTrendDay[]
  total: number
}

export interface MyDeadlineSlice {
  label: string
  count: number
}

export interface MyDeadlinePerformance {
  days: number
  total: number
  slices: MyDeadlineSlice[]
  on_time_rate: number
}

export interface MyPersonalActivityItem {
  id: string
  type: string
  title: string
  description: string | null
  project_id: string | null
  project_name: string | null
  task_id: string | null
  created_at: string
}

export interface MyPersonalActivity {
  items: MyPersonalActivityItem[]
}

/* ---------------- My Analytics Phase 2 ---------------- */

export interface MyWorkPattern {
  days: number
  most_productive_day: string | null
  most_productive_hour: number | null
  avg_login_time: string | null
  avg_logout_time: string | null
  timezone: string
}

export interface MyTimeDistributionSlice {
  project_id: string | null
  category: string
  label: string
  seconds: number
  percentage: number
}

export interface MyTimeDistribution {
  days: number
  total_seconds: number
  slices: MyTimeDistributionSlice[]
}

export interface MyProjectContributionRow {
  project_id: string
  project_name: string
  completed_tasks: number
  percentage: number
}

export interface MyProjectContribution {
  days: number
  total_completed: number
  projects: MyProjectContributionRow[]
}

export interface MyCollaboration {
  days: number
  comments: number
  mentions: number
  reviews: number
  attachments: number
}

export interface MyPrioritySlice {
  priority: string
  label: string
  count: number
  percentage: number
}

export interface MyPriorityAnalysis {
  days: number
  total: number
  slices: MyPrioritySlice[]
}

export interface MyBenchmarkMetric {
  key: string
  label: string
  current: number
  previous: number
  change: number
  change_pct: number | null
  improved: boolean
}

export interface MyPersonalBenchmarks {
  period: string
  metrics: MyBenchmarkMetric[]
}
