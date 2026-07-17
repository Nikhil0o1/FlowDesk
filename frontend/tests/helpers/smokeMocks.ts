import { vi } from 'vitest'

import { api } from '@/lib/api'
import { mockProject } from '@tests/fixtures'
import {
  emptyPage,
  mockBurndown,
  mockCalendarEvent,
  mockChannel,
  mockChatMessage,
  mockComment,
  mockFormDef,
  mockNotification,
  mockOrgMember,
  mockOrgMember2,
  mockSprint,
  mockStandup,
  mockStatus,
  mockTask,
  mockTeam,
  mockTimeEntry,
  mockUserBrief,
  mockWhiteboard,
} from '@tests/mockData'
import {
  useChannels,
  useForms,
  useOrganizationMembers,
  useProjects,
  useSprints,
  useStatuses,
  useTeams,
  useWhiteboards,
  useWorkspaceMembers,
} from '@/lib/queries'

const emptyList = { data: [] as unknown[], isLoading: false }

export function setupPopulatedQueryMocks() {
  vi.mocked(useTeams).mockReturnValue({
    data: [mockTeam()],
    isLoading: false,
  } as ReturnType<typeof useTeams>)
  vi.mocked(useChannels).mockReturnValue({
    data: [mockChannel()],
    isLoading: false,
  } as ReturnType<typeof useChannels>)
  vi.mocked(useSprints).mockReturnValue({
    data: [mockSprint()],
    isLoading: false,
  } as ReturnType<typeof useSprints>)
  vi.mocked(useForms).mockReturnValue({
    data: [mockFormDef()],
    isLoading: false,
  } as ReturnType<typeof useForms>)
  vi.mocked(useProjects).mockReturnValue({
    data: [mockProject],
    isLoading: false,
  } as ReturnType<typeof useProjects>)
  vi.mocked(useWorkspaceMembers).mockReturnValue({
    data: [mockOrgMember(), mockOrgMember2()],
    isLoading: false,
  } as ReturnType<typeof useWorkspaceMembers>)
  vi.mocked(useOrganizationMembers).mockReturnValue({
    data: [mockOrgMember(), mockOrgMember2()],
    isLoading: false,
  } as ReturnType<typeof useOrganizationMembers>)
  vi.mocked(useStatuses).mockReturnValue({
    data: [mockStatus],
    isLoading: false,
  } as ReturnType<typeof useStatuses>)
  vi.mocked(useWhiteboards).mockReturnValue({
    data: [mockWhiteboard()],
    isLoading: false,
  } as ReturnType<typeof useWhiteboards>)
}

export function resetQueryMocks() {
  vi.mocked(useTeams).mockReturnValue(emptyList as ReturnType<typeof useTeams>)
  vi.mocked(useChannels).mockReturnValue(emptyList as ReturnType<typeof useChannels>)
  vi.mocked(useSprints).mockReturnValue(emptyList as ReturnType<typeof useSprints>)
  vi.mocked(useForms).mockReturnValue(emptyList as ReturnType<typeof useForms>)
  vi.mocked(useProjects).mockReturnValue(emptyList as ReturnType<typeof useProjects>)
  vi.mocked(useWorkspaceMembers).mockReturnValue(emptyList as ReturnType<typeof useWorkspaceMembers>)
  vi.mocked(useOrganizationMembers).mockReturnValue(emptyList as ReturnType<typeof useOrganizationMembers>)
  vi.mocked(useStatuses).mockReturnValue(emptyList as ReturnType<typeof useStatuses>)
  vi.mocked(useWhiteboards).mockReturnValue(emptyList as ReturnType<typeof useWhiteboards>)
}

export function setupPopulatedApiMock() {
  vi.mocked(api.get).mockImplementation(async (url: string) => {
    // Task-scoped list endpoints (must precede broader /tasks/ handlers)
    if (/\/tasks\/[^/]+\/sprints/.test(url)) return []
    if (/\/tasks\/[^/]+\/comments/.test(url)) {
      return { ...emptyPage, items: [mockComment()], page_size: 200, total: 1 }
    }

    // Channel detail (most specific first)
    if (url.includes('/channels/ch-1/messages')) {
      return { ...emptyPage, items: [mockChatMessage()], page_size: 100, total: 1 }
    }
    if (url.includes('/channels/ch-1/members')) {
      return [
        { id: 'cm-1', user_id: 'user-1', role: 'admin', user: mockUserBrief },
        { id: 'cm-2', user_id: 'user-2', role: 'member', user: mockOrgMember2().user },
      ]
    }
    if (url.includes('/channels/')) return mockChannel()

    // Sprint detail
    if (url.includes('/sprints/sprint-1/burndown')) return mockBurndown()
    if (url.includes('/sprints/sprint-1/standups')) {
      return { ...emptyPage, items: [mockStandup()], page_size: 100, total: 1 }
    }
    if (url.includes('/sprints/sprint-1/tasks')) return [mockTask()]
    if (url.includes('/sprints/')) return [mockSprint()]

    // Project tasks (backlog)
    if (url.includes('/projects/proj-1/tasks')) {
      return { ...emptyPage, items: [mockTask({ id: 'task-2', ref: 'ALPHA-2', title: 'Write tests' })], total: 1, page_size: 200 }
    }
    if (url.includes('/projects/') && url.includes('/tasks')) {
      return { ...emptyPage, items: [mockTask()], total: 1, page_size: 50 }
    }

    // My tasks / planner
    if (url.includes('/me/tasks/summary')) {
      return { assigned: 1, today_and_overdue: 0, personal_list_count: 0, delegated: 0 }
    }
    if (url.includes('/me/tasks')) {
      return { ...emptyPage, items: [mockTask()], total: 1, page_size: 200 }
    }

    // Time entries
    if (url.includes('/me/time-entries')) {
      return { ...emptyPage, items: [mockTimeEntry()], total: 1, page_size: 500 }
    }

    // Notifications
    if (url.includes('/notifications/inbox-settings')) {
      return {
        show_all_tab: false,
        group_by_date: true,
        sort_newest_first: true,
        display_mode: 'fullscreen',
        email_notifications_enabled: true,
        browser_notifications_enabled: false,
        auto_follow_tasks: true,
      }
    }
    if (url.includes('/notifications/preferences')) {
      return { important_count: 1, total_count: 3, types: {} }
    }
    if (url.includes('/notifications/summary')) {
      return { mentions: 0, assigned_to_me: 1, unread: 1, reminders: 0 }
    }
    if (url.includes('/notifications/replies-unread-count')) {
      return { count: 0 }
    }
    if (url.includes('/notifications') && url.includes('view=inbox')) {
      return { ...emptyPage, items: [mockNotification()], total: 1, page_size: 30 }
    }
    if (url.includes('/notifications')) {
      return { ...emptyPage, items: [mockNotification()], total: 1, page_size: 30 }
    }

    // Calendar
    if (url.includes('/calendar/events')) return [mockCalendarEvent()]
    if (url.includes('/calendar/status')) {
      return {
        google: { configured: true, connected: true, account_email: 'test@example.com', scopes: { calendar: true } },
        outlook: { configured: false },
      }
    }

    // Integrations / GitHub
    if (url.includes('/integrations/google/status')) {
      return { configured: true, connected: false, account_email: null, scopes: {} }
    }
    if (url.includes('/github/organizations/')) {
      return { connected: false, github_user_login: null }
    }
    if (url.includes('/github/projects/')) {
      if (url.includes('/search')) return { connected: false, items: [] }
      if (url.includes('/available-repos')) return []
      if (url.includes('/repositories')) return []
      return { connected: false, github_user_login: null }
    }

    // Workspace / org
    if (url.includes('/workspaces/ws-1/members')) return [mockOrgMember(), mockOrgMember2()]
    if (url.includes('/organizations/org-1/members')) return [mockOrgMember(), mockOrgMember2()]
    if (url.includes('/organizations/org-1/audit-logs')) {
      return {
        ...emptyPage,
        items: [
          {
            id: 'audit-1',
            action: 'task.created',
            target_type: 'task',
            target_id: 'task-1',
            created_at: '2024-06-01T10:00:00Z',
            actor: mockUserBrief,
          },
        ],
        total: 1,
      }
    }
    if (url.includes('/workspaces/ws-1/teams')) return [mockTeam()]
    if (url.includes('/workspaces/ws-1/sprints')) return [mockSprint()]
    if (url.includes('/workspaces/ws-1/channels')) return [mockChannel()]
    if (url.includes('/workspaces/ws-1/forms')) return [mockFormDef()]
    if (url.includes('/workspaces/ws-1/whiteboards')) return [mockWhiteboard()]
    if (url.includes('/workspaces/ws-1/task-stats')) {
      return {
        total_tasks: 10,
        open_tasks: 6,
        completed_tasks: 4,
        overdue_tasks: 1,
        by_status: [{ name: 'Open', color: '#2B88EE', count: 6 }],
        by_project: [{ project_id: 'proj-1', project_name: 'Alpha Project', count: 5 }],
      }
    }

    // Forms / whiteboards
    if (url === '/forms/form-1' || url.endsWith('/forms/form-1')) return mockFormDef()
    if (url.includes('/forms/')) return mockFormDef()
    if (url.includes('/whiteboards/wb-1')) {
      return {
        ...mockWhiteboard(),
        content: { elements: [], files: {}, appState: {} },
      }
    }

    // Auth / misc
    if (url === '/auth/me') return { user: { ...mockUserBrief, profile: { full_name: 'Test User' } } }
    if (url.includes('/custom-fields')) return []
    if (url.includes('/comments')) {
      return { ...emptyPage, items: [mockComment()], page_size: 200, total: 1 }
    }
    if (url.includes('/activity')) return emptyPage
    if (url.includes('/search')) return { tasks: [], projects: [], users: [] }
    if (url.includes('/share')) {
      return {
        is_private: false,
        public_enabled: false,
        public_url: null,
        public_expires_at: null,
        public_searchable: false,
        members: [],
      }
    }

    // Public pages
    if (url.startsWith('http') || url.includes('/public/tasks/')) {
      return {
        title: 'Shared task',
        ref: 'PHX-1',
        description: null,
        task_type: 'task',
        priority: null,
        due_date: null,
        status: { name: 'Open', color: '#2B88EE' },
        assignees: [],
        checklists: [],
      }
    }

    return {}
  })
}
