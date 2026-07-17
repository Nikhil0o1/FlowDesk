import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'
import { Route, Routes } from 'react-router-dom'

import { api, get2faStatus } from '@/lib/api'
import { fetchPublicForm } from '@/lib/publicForms'
import { useCalendarStatus } from '@/lib/googleCalendar'
import { mockCurrentContext, mockLoginContext, mockUser } from '@tests/fixtures'
import { emptyPage, mockTask } from '@tests/mockData'
import { renderWithProviders } from '@tests/renderWithProviders'
import { setupPopulatedApiMock, setupPopulatedQueryMocks, resetQueryMocks } from '@tests/smokeMocks'
import { useAuthStore } from '@/stores/auth'
import { useCurrentContext, useUserRoles } from '@/lib/queries'
import {
  usePlannerOverdueTasks,
  usePlannerWeekTasks,
} from '@/components/planner/usePlannerTasks'

vi.mock('qrcode.react', () => ({
  QRCodeSVG: () => <div data-testid="qr-code" />,
}))

vi.mock('@/lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api')>()
  return {
    ...actual,
    get2faStatus: vi.fn(),
    api: {
      get: vi.fn().mockResolvedValue({}),
      post: vi.fn().mockResolvedValue({}),
      put: vi.fn().mockResolvedValue({}),
      patch: vi.fn().mockResolvedValue({}),
      delete: vi.fn().mockResolvedValue(undefined),
    },
  }
})

vi.mock('@/lib/googleCalendar', () => ({
  useCalendarStatus: vi.fn(() => ({
    isLoading: false,
    data: { google: { connected: false, configured: false }, outlook: { configured: false } },
  })),
  startGoogleConnect: vi.fn(),
}))

vi.mock('@/components/planner/usePlannerTasks', () => ({
  usePlannerOverdueTasks: vi.fn(() => ({ data: { ...emptyPage, items: [] }, isLoading: false })),
  usePlannerWeekTasks: vi.fn(() => ({ data: { ...emptyPage, items: [] }, isLoading: false })),
  invalidatePlannerTasks: vi.fn(),
}))

vi.mock('@/lib/publicForms', () => ({
  fetchPublicForm: vi.fn(),
  submitPublicForm: vi.fn(),
  copyPublicFormLink: vi.fn(),
}))

// Pages lazy-loaded per test — avoids loading the full app tree at collect time.

describe('page smoke renders', () => {
  afterEach(() => {
    resetQueryMocks()
  })

  beforeEach(() => {
    useAuthStore.setState({
      user: mockUser,
      loginContext: mockLoginContext,
      initialized: true,
      accessToken: 'test-token',
    })
    vi.mocked(useCurrentContext).mockReturnValue(mockCurrentContext())
    vi.mocked(get2faStatus).mockResolvedValue({
      enrolled: false,
      org_required: false,
      recovery_codes_remaining: 0,
    })
    vi.mocked(fetchPublicForm).mockResolvedValue({
      id: 'form-1',
      name: 'Feedback',
      description: null,
      is_active: true,
      fields: [],
      public_token: 'pub-token',
      workspace_name: 'Main Workspace',
    } as Awaited<ReturnType<typeof fetchPublicForm>>)
    setupPopulatedQueryMocks()
    setupPopulatedApiMock()
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            title: 'Shared task',
            ref: 'PHX-1',
            description: null,
            task_type: 'task',
            priority: null,
            due_date: null,
            status: { name: 'Open', color: '#2B88EE' },
            assignees: [],
            checklists: [],
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        ),
      ),
    )
  })

  it('AssignedToMePage shows assigned tasks', async () => {
    const { default: AssignedToMePage } = await import('@/pages/app/myTasks/AssignedToMePage')
    renderWithProviders(<AssignedToMePage />)
    expect(await screen.findByText('Assigned to me')).toBeInTheDocument()
    expect(await screen.findByText('Fix bug')).toBeInTheDocument()
  })

  it('TeamsPage shows team grid', async () => {
    const { default: TeamsPage } = await import('@/pages/app/TeamsPage')
    renderWithProviders(<TeamsPage />)
    expect(await screen.findByRole('heading', { name: 'All Teams' })).toBeInTheDocument()
    expect(screen.getByText('Engineering')).toBeInTheDocument()
  })

  it('TeamsPage people tab', async () => {
    vi.mocked(useUserRoles).mockReturnValue({
      data: {
        highest_role: 'org_owner',
        org_role: 'owner',
        org_name: 'Acme Corp',
        workspace_roles: [],
        space_roles: [],
        project_roles: [],
      },
      isLoading: false,
    } as ReturnType<typeof useUserRoles>)
    const { default: TeamsPage } = await import('@/pages/app/TeamsPage')
    renderWithProviders(<TeamsPage />, {
      routerProps: { initialEntries: ['/app/teams?tab=people'] },
    })
    expect(await screen.findByRole('heading', { name: 'All People' })).toBeInTheDocument()
    expect(await screen.findByText('Test User')).toBeInTheDocument()
    expect(screen.getByText('Jane Doe')).toBeInTheDocument()
  })

  it('FormsPage shows forms list', async () => {
    const { default: FormsPage } = await import('@/pages/app/FormsPage')
    renderWithProviders(<FormsPage />)
    expect(await screen.findByRole('heading', { name: 'All Forms' })).toBeInTheDocument()
    expect((await screen.findAllByText('Feedback Form')).length).toBeGreaterThan(0)
  })

  it('PlannerPage disconnected hero', async () => {
    const { default: PlannerPage } = await import('@/pages/app/PlannerPage')
    renderWithProviders(<PlannerPage />)
    expect(await screen.findByRole('heading', { name: /You, but better/i })).toBeInTheDocument()
  })

  it('PlannerPage connected week grid', async () => {
    const { default: PlannerPage } = await import('@/pages/app/PlannerPage')
    vi.mocked(useCalendarStatus).mockReturnValue({
      isLoading: false,
      data: {
        google: { connected: true, configured: true, account_email: 'test@example.com', scopes: { calendar: true } },
        outlook: { configured: false },
      },
    } as ReturnType<typeof useCalendarStatus>)
    const today = new Date().toISOString().slice(0, 10)
    vi.mocked(usePlannerWeekTasks).mockReturnValue({
      data: { ...emptyPage, items: [mockTask({ due_date: today })], total: 1, page_size: 50 },
      isLoading: false,
    } as ReturnType<typeof usePlannerWeekTasks>)
    vi.mocked(usePlannerOverdueTasks).mockReturnValue({
      data: { ...emptyPage, items: [mockTask({ id: 'task-overdue', title: 'Overdue task' })], total: 1, page_size: 20 },
      isLoading: false,
    } as ReturnType<typeof usePlannerOverdueTasks>)
    vi.mocked(api.get).mockImplementation(async (url: string) => {
      if (url.includes('/calendar/events')) return []
      return {}
    })

    renderWithProviders(<PlannerPage />)
    expect(await screen.findByRole('heading', { name: 'Planner' }, { timeout: 10000 })).toBeInTheDocument()
    expect(await screen.findByText('test@example.com')).toBeInTheDocument()
    expect(await screen.findByText('Overdue task')).toBeInTheDocument()
  }, 15000)

  it('ChatPage shows channel conversation', async () => {
    const { default: ChatPage } = await import('@/pages/app/ChatPage')
    renderWithProviders(<ChatPage />, {
      routerProps: { initialEntries: ['/app/chat?channel=ch-1'] },
    })
    expect(await screen.findByText('Chat')).toBeInTheDocument()
    expect(await screen.findByText('Hello team!')).toBeInTheDocument()
  })

  it('NotificationsPage shows inbox items', async () => {
    const { default: NotificationsPage } = await import('@/pages/app/NotificationsPage')
    renderWithProviders(<NotificationsPage />)
    expect(await screen.findByRole('button', { name: 'Primary' })).toBeInTheDocument()
    expect(await screen.findByText('You were assigned to Fix bug')).toBeInTheDocument()
  })

  it('WorkspacesPage shows workspace cards', async () => {
    const { default: WorkspacesPage } = await import('@/pages/app/WorkspacesPage')
    renderWithProviders(<WorkspacesPage />)
    expect(await screen.findByRole('heading', { name: 'Workspaces' })).toBeInTheDocument()
    expect(screen.getByText('Main Workspace')).toBeInTheDocument()
  })

  it('SprintsPage shows sprint detail', async () => {
    const { default: SprintsPage } = await import('@/pages/app/SprintsPage')
    renderWithProviders(<SprintsPage />, {
      routerProps: { initialEntries: ['/app/sprints?sprint=sprint-1'] },
    })
    expect(await screen.findByText('Sprints')).toBeInTheDocument()
    expect(await screen.findByRole('heading', { name: 'Sprint 1' })).toBeInTheDocument()
    expect(screen.getByText('Ship MVP')).toBeInTheDocument()
    expect(screen.getByText('Fix bug')).toBeInTheDocument()
  })

  it('TimesheetPage shows week grid', async () => {
    const { default: TimesheetPage } = await import('@/pages/app/TimesheetPage')
    renderWithProviders(<TimesheetPage />)
    expect(await screen.findByRole('heading', { name: 'Timesheets' })).toBeInTheDocument()
    expect(await screen.findByText('Fix bug')).toBeInTheDocument()
    expect(screen.getAllByText('1h 30m').length).toBeGreaterThan(0)
  })

  it('AppCenterPage', async () => {
    const { default: AppCenterPage } = await import('@/pages/app/AppCenterPage')
    renderWithProviders(<AppCenterPage />)
    expect(await screen.findByRole('heading', { name: 'App Center' })).toBeInTheDocument()
  })

  it('SettingsPage profile tab', async () => {
    const { default: SettingsPage } = await import('@/pages/app/SettingsPage')
    renderWithProviders(<SettingsPage />)
    expect(await screen.findByRole('heading', { name: 'Settings' })).toBeInTheDocument()
    expect(await screen.findByDisplayValue('Test User')).toBeInTheDocument()
  })

  it('SettingsPage security tab', async () => {
    const { default: SettingsPage } = await import('@/pages/app/SettingsPage')
    renderWithProviders(<SettingsPage />, {
      routerProps: { initialEntries: ['/app/settings?tab=security'] },
    })
    expect(await screen.findByText(/Two-factor authentication/i)).toBeInTheDocument()
  })

  it('SettingsPage audit tab', async () => {
    const { default: SettingsPage } = await import('@/pages/app/SettingsPage')
    renderWithProviders(<SettingsPage />, {
      routerProps: { initialEntries: ['/app/settings?tab=audit'] },
    })
    expect(await screen.findByText('task.created')).toBeInTheDocument()
  })

  it('SettingsPage time tab', async () => {
    const { default: SettingsPage } = await import('@/pages/app/SettingsPage')
    renderWithProviders(<SettingsPage />, {
      routerProps: { initialEntries: ['/app/settings?tab=time'] },
    })
    expect(await screen.findByText(/Total tracked/i)).toBeInTheDocument()
    expect(screen.getByText('ALPHA-1')).toBeInTheDocument()
  })

  it('PublicFormPage', async () => {
    const { default: PublicFormPage } = await import('@/pages/public/PublicFormPage')
    renderWithProviders(
      <Routes>
        <Route path="/f/:token" element={<PublicFormPage />} />
      </Routes>,
      { routerProps: { initialEntries: ['/f/pub-token'] } },
    )
    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'Feedback' })).toBeInTheDocument()
    })
  })

  it('PublicTaskPage', async () => {
    const { default: PublicTaskPage } = await import('@/pages/public/PublicTaskPage')
    renderWithProviders(
      <Routes>
        <Route path="/t/:token" element={<PublicTaskPage />} />
      </Routes>,
      { routerProps: { initialEntries: ['/t/share-token'] } },
    )
    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'Shared task' })).toBeInTheDocument()
    })
  })
})

describe('page smoke interactions', () => {
  afterEach(() => {
    resetQueryMocks()
  })

  beforeEach(() => {
    useAuthStore.setState({
      user: mockUser,
      loginContext: mockLoginContext,
      initialized: true,
      accessToken: 'test-token',
    })
    vi.mocked(useCurrentContext).mockReturnValue(mockCurrentContext())
    vi.mocked(get2faStatus).mockResolvedValue({
      enrolled: false,
      org_required: false,
      recovery_codes_remaining: 0,
    })
    setupPopulatedQueryMocks()
    setupPopulatedApiMock()
  })

  it('AssignedToMePage toggles closed tasks filter', async () => {
    const { default: AssignedToMePage } = await import('@/pages/app/myTasks/AssignedToMePage')
    const user = userEvent.setup()
    renderWithProviders(<AssignedToMePage />)
    await screen.findByText('Fix bug')
    await user.click(screen.getByRole('button', { name: 'Closed' }))
    expect(api.get).toHaveBeenCalled()
  })

  it('SprintsPage switches detail tabs', async () => {
    const { default: SprintsPage } = await import('@/pages/app/SprintsPage')
    const user = userEvent.setup()
    renderWithProviders(<SprintsPage />, {
      routerProps: { initialEntries: ['/app/sprints?sprint=sprint-1'] },
    })
    await screen.findByRole('heading', { name: 'Sprint 1' })
    await user.click(screen.getByRole('button', { name: 'backlog' }))
    expect(await screen.findByText('In sprint (1)')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'burndown' }))
    expect(await screen.findByText('3/8 pts done')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'standups' }))
    expect(await screen.findByText("Today's standup")).toBeInTheDocument()
    expect(screen.getByText('Fixed login bug')).toBeInTheDocument()
  })

  it('TimesheetPage switches to entries tab', async () => {
    const { default: TimesheetPage } = await import('@/pages/app/TimesheetPage')
    const user = userEvent.setup()
    renderWithProviders(<TimesheetPage />)
    await screen.findByRole('heading', { name: 'Timesheets' })
    await user.click(screen.getByRole('button', { name: 'Time entries' }))
    expect(await screen.findByText('ALPHA-1')).toBeInTheDocument()
  })

  it('SettingsPage switches organization tab', async () => {
    const { default: SettingsPage } = await import('@/pages/app/SettingsPage')
    const user = userEvent.setup()
    renderWithProviders(<SettingsPage />)
    await screen.findByDisplayValue('Test User')
    await user.click(screen.getByRole('button', { name: /Organization/i }))
    expect(await screen.findByDisplayValue('Acme Corp')).toBeInTheDocument()
  })

  it('NotificationsPage marks all read from settings', async () => {
    const { default: NotificationsPage } = await import('@/pages/app/NotificationsPage')
    const user = userEvent.setup()
    renderWithProviders(<NotificationsPage />)
    await screen.findByText('You were assigned to Fix bug')
    await user.click(screen.getByTitle('Customize Inbox'))
    await user.click(await screen.findByRole('button', { name: 'Notification settings' }))
    await user.click(screen.getByRole('button', { name: /Mark all notifications as read/i }))
    expect(api.post).toHaveBeenCalledWith('/notifications/read-all')
  })

  it('FormsPage filters with search', async () => {
    const { default: FormsPage } = await import('@/pages/app/FormsPage')
    const user = userEvent.setup()
    renderWithProviders(<FormsPage />)
    await screen.findAllByText('Feedback Form')
    await user.type(screen.getByPlaceholderText('Search'), 'Feedback')
    expect(screen.getAllByText('Feedback Form').length).toBeGreaterThan(0)
  })

  it('ChatPage opens channel options', async () => {
    const { default: ChatPage } = await import('@/pages/app/ChatPage')
    const user = userEvent.setup()
    renderWithProviders(<ChatPage />, {
      routerProps: { initialEntries: ['/app/chat?channel=ch-1'] },
    })
    await screen.findByText('Hello team!')
    await user.click(screen.getByTitle('Channel options'))
    await user.click(screen.getByRole('button', { name: /Settings/i }))
    expect(await screen.findByRole('heading', { name: 'Channel settings' })).toBeInTheDocument()
  })

  it('TeamsPage opens team manage modal', async () => {
    const { default: TeamsPage } = await import('@/pages/app/TeamsPage')
    const user = userEvent.setup()
    renderWithProviders(<TeamsPage />, {
      routerProps: { initialEntries: ['/app/teams?team=team-1'] },
    })
    expect(await screen.findByDisplayValue('Engineering')).toBeInTheDocument()
    expect(screen.getByText('Jane Doe')).toBeInTheDocument()
  })
})
