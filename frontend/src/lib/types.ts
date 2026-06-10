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
  profile: Profile | null
}

export interface TokenResponse {
  access_token: string
  token_type: string
  expires_in: number
  user: User
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
  slug: string
  logo_url: string | null
  is_disabled: boolean
  plan: string
  seats: number
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
}

export interface Project {
  id: string
  space_id: string
  workspace_id: string
  name: string
  key: string
  description: string | null
  color: string
  icon: string | null
  position: number
  is_archived: boolean
  created_at: string
  my_role: string | null
  task_count: number | null
  done_task_count: number | null
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

export interface TaskDetail extends Task {
  subtasks: Task[]
  dependencies: TaskDependency[]
  dependents: TaskDependency[]
  attachments: Attachment[]
  total_tracked_seconds: number
}

export interface Comment {
  id: string
  task_id: string
  author_id: string
  parent_comment_id: string | null
  body: string
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
  workspace_id: string | null
  project_id: string | null
  created_at: string
}

export interface Channel {
  id: string
  workspace_id: string
  project_id: string | null
  name: string
  description: string | null
  is_private: boolean
  is_direct: boolean
  created_at: string
  member_count: number
  unread_count: number
  last_message_at: string | null
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

export interface OrgMember {
  id: string
  user_id: string
  role: string
  created_at: string
  user: UserBrief | null
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
}

export interface OrgMetadata {
  id: string
  name: string
  slug: string
  is_disabled: boolean
  plan: string
  seats: number
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

export interface Team {
  id: string
  workspace_id: string
  name: string
  description: string | null
  color: string
  created_by: string | null
  created_at: string
  members: UserBrief[]
}

export interface WhiteboardElement {
  id: string
  type: 'sticky' | 'text' | 'rect' | 'ellipse'
  x: number
  y: number
  w: number
  h: number
  text: string
  color: string
}

export interface Whiteboard {
  id: string
  workspace_id: string
  name: string
  created_by: string | null
  created_at: string
  updated_at: string
  element_count: number
  creator: UserBrief | null
  content?: { elements: WhiteboardElement[] }
}

export type FormFieldType = 'text' | 'textarea' | 'select' | 'date' | 'email'

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
