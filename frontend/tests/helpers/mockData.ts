import type {
  AppNotification,
  CalendarEvent,
  Channel,
  ChatMessage,
  Comment,
  CustomStatus,
  FormDef,
  OrgMember,
  Sprint,
  SprintBurndown,
  Standup,
  Task,
  TaskDetail,
  Team,
  TimeEntry,
  UserBrief,
  Whiteboard,
  WorkspaceDashboard,
} from '@/lib/types'
import { mockProject } from '@tests/fixtures'

export const mockStatus: CustomStatus = {
  id: 'status-1',
  project_id: 'proj-1',
  name: 'Open',
  color: '#2B88EE',
  category: 'todo',
  position: 0,
}

export const mockStatusDone: CustomStatus = {
  id: 'status-2',
  project_id: 'proj-1',
  name: 'Done',
  color: '#4CB782',
  category: 'done',
  position: 1,
}

export function mockTask(overrides: Partial<Task> = {}): Task {
  return {
    id: 'task-1',
    project_id: 'proj-1',
    list_id: null,
    parent_task_id: null,
    number: 1,
    ref: 'ALPHA-1',
    title: 'Fix bug',
    description: null,
    priority: 'normal',
    task_type: 'task',
    start_date: null,
    due_date: null,
    planned_start_at: null,
    planned_end_at: null,
    google_calendar_event_id: null,
    story_points: null,
    position: 0,
    labels: [],
    is_archived: false,
    completed_at: null,
    created_by: 'user-1',
    created_at: '2024-01-01T00:00:00Z',
    updated_at: '2024-01-01T00:00:00Z',
    status: mockStatus,
    assignees: [],
    subtask_count: 0,
    subtask_done_count: 0,
    comment_count: 0,
    github_issue_number: null,
    github_issue_url: null,
    time_estimate_seconds: null,
    is_private: false,
    ...overrides,
  }
}

export function mockTaskDetail(overrides: Partial<TaskDetail> = {}): TaskDetail {
  return {
    ...mockTask(),
    subtasks: [],
    dependencies: [],
    dependents: [],
    attachments: [],
    total_tracked_seconds: 0,
    checklists: [],
    custom_fields: [],
    ...overrides,
  }
}

export function mockFormDef(overrides: Partial<FormDef> = {}): FormDef {
  return {
    id: 'form-1',
    workspace_id: 'ws-1',
    project_id: 'proj-1',
    name: 'Feedback Form',
    description: null,
    fields: [{ id: 'f1', type: 'text', label: 'Name', required: false }],
    public_token: 'pub-token',
    is_active: true,
    created_by: 'user-1',
    created_at: '2024-01-01T00:00:00Z',
    updated_at: '2024-01-01T00:00:00Z',
    submission_count: 0,
    project_name: mockProject.name,
    ...overrides,
  }
}

export const emptyPage = { items: [], total: 0, page: 1, page_size: 30 }

export const mockUserBrief: UserBrief = {
  id: 'user-1',
  email: 'test@example.com',
  full_name: 'Test User',
  avatar_url: null,
}

export const mockUserBrief2: UserBrief = {
  id: 'user-2',
  email: 'jane@example.com',
  full_name: 'Jane Doe',
  avatar_url: null,
}

export function mockOrgMember(overrides: Partial<OrgMember> = {}): OrgMember {
  return {
    id: 'om-1',
    user_id: 'user-1',
    role: 'owner',
    created_at: '2024-01-01T00:00:00Z',
    user: mockUserBrief,
    ...overrides,
  }
}

export function mockOrgMember2(overrides: Partial<OrgMember> = {}): OrgMember {
  return {
    id: 'om-2',
    user_id: 'user-2',
    role: 'member',
    created_at: '2024-01-02T00:00:00Z',
    user: mockUserBrief2,
    ...overrides,
  }
}

export function mockTeam(overrides: Partial<Team> = {}): Team {
  return {
    id: 'team-1',
    workspace_id: 'ws-1',
    name: 'Engineering',
    description: 'Core engineering team',
    color: '#2B88EE',
    created_by: 'user-1',
    created_at: '2024-01-01T00:00:00Z',
    members: [mockUserBrief, mockUserBrief2],
    member_details: [],
    my_role: 'admin',
    can_manage_members: true,
    can_delete: true,
    can_create_teams: true,
    ...overrides,
  }
}

export function mockChannel(overrides: Partial<Channel> = {}): Channel {
  return {
    id: 'ch-1',
    workspace_id: 'ws-1',
    project_id: null,
    name: 'general',
    description: 'General discussion',
    is_private: false,
    is_direct: false,
    created_at: '2024-01-01T00:00:00Z',
    member_count: 2,
    unread_count: 1,
    last_message_at: '2024-06-01T12:00:00Z',
    ...overrides,
  }
}

export function mockChatMessage(overrides: Partial<ChatMessage> = {}): ChatMessage {
  return {
    id: 'msg-1',
    channel_id: 'ch-1',
    author_id: 'user-2',
    parent_message_id: null,
    body: 'Hello team!',
    edited_at: null,
    created_at: '2024-06-01T12:00:00Z',
    author: mockUserBrief2,
    ...overrides,
  }
}

export function mockSprint(overrides: Partial<Sprint> = {}): Sprint {
  return {
    id: 'sprint-1',
    workspace_id: 'ws-1',
    project_id: 'proj-1',
    name: 'Sprint 1',
    goal: 'Ship MVP',
    start_date: '2024-06-01',
    end_date: '2024-06-14',
    status: 'active',
    scrum_master_id: 'user-1',
    started_at: '2024-06-01T00:00:00Z',
    completed_at: null,
    created_at: '2024-01-01T00:00:00Z',
    scrum_master: mockUserBrief,
    task_count: 2,
    total_points: 8,
    completed_points: 3,
    ...overrides,
  }
}

export function mockBurndown(): SprintBurndown {
  return {
    sprint_id: 'sprint-1',
    total_points: 8,
    completed_points: 3,
    points: [
      { day: '2024-06-01', remaining_points: 8, ideal_points: 8 },
      { day: '2024-06-07', remaining_points: 5, ideal_points: 4 },
      { day: '2024-06-14', remaining_points: 3, ideal_points: 0 },
    ],
  }
}

export function mockStandup(overrides: Partial<Standup> = {}): Standup {
  return {
    id: 'standup-1',
    sprint_id: 'sprint-1',
    user_id: 'user-1',
    for_date: '2024-06-01',
    yesterday: 'Fixed login bug',
    today: 'Review PRs',
    blockers: null,
    created_at: '2024-06-01T09:00:00Z',
    user: mockUserBrief,
    ...overrides,
  }
}

export function mockComment(overrides: Partial<Comment> = {}): Comment {
  return {
    id: 'comment-1',
    task_id: 'task-1',
    author_id: 'user-1',
    parent_comment_id: null,
    body: 'Looks good to me',
    created_at: '2024-06-01T10:00:00Z',
    updated_at: '2024-06-01T10:00:00Z',
    author: mockUserBrief,
    reply_count: 0,
    ...overrides,
  }
}

export function mockNotification(overrides: Partial<AppNotification> = {}): AppNotification {
  return {
    id: 'notif-1',
    type: 'task_assigned',
    title: 'You were assigned to Fix bug',
    body: 'ALPHA-1 needs your attention',
    data: { task_id: 'task-1' },
    read_at: null,
    workspace_id: 'ws-1',
    project_id: 'proj-1',
    created_at: '2024-06-01T10:00:00Z',
    ...overrides,
  }
}

export function mockTimeEntry(overrides: Partial<TimeEntry> = {}): TimeEntry {
  return {
    id: 'te-1',
    task_id: 'task-1',
    user_id: 'user-1',
    started_at: '2024-06-01T09:00:00Z',
    ended_at: '2024-06-01T10:30:00Z',
    duration_seconds: 5400,
    description: 'Bug investigation',
    is_manual: true,
    stopped_by_system: false,
    created_at: '2024-06-01T10:30:00Z',
    user: mockUserBrief,
    task_title: 'Fix bug',
    task_ref: 'ALPHA-1',
    ...overrides,
  }
}

export function mockCalendarEvent(overrides: Partial<CalendarEvent> = {}): CalendarEvent {
  return {
    id: 'evt-1',
    summary: 'Team standup',
    start: '2024-06-01T09:00:00Z',
    end: '2024-06-01T09:30:00Z',
    all_day: false,
    link: 'https://calendar.google.com/event/1',
    meet_link: 'https://meet.google.com/abc-defg-hij',
    ...overrides,
  }
}

export function mockWhiteboard(overrides: Partial<Whiteboard> = {}): Whiteboard {
  return {
    id: 'wb-1',
    workspace_id: 'ws-1',
    name: 'Sprint Board',
    created_by: 'user-1',
    created_at: '2024-01-01T00:00:00Z',
    updated_at: '2024-01-01T00:00:00Z',
    element_count: 3,
    creator: mockUserBrief,
    ...overrides,
  }
}

export function mockWorkspaceDashboard(overrides: Partial<WorkspaceDashboard> = {}): WorkspaceDashboard {
  return {
    workspace_id: 'ws-1',
    workspace_name: 'Main Workspace',
    kpis: {
      total_tasks: 0,
      open_tasks: 0,
      completed_tasks: 0,
      overdue_tasks: 0,
      completion_percent: 0,
      spaces: 1,
      projects: 1,
      members: 2,
      active_sprints: 0,
      trends: {},
    },
    space_overview: [],
    task_status_breakdown: [],
    task_status_total: 0,
    project_progress: [],
    project_progress_total: 0,
    member_workload: [],
    active_sprints: [],
    critical_tasks: [],
    critical_tasks_total: 0,
    recent_activities: [],
    ...overrides,
  }
}
