import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'
import { Route, Routes } from 'react-router-dom'

import { api } from '@/lib/api'
import { mockCurrentContext, mockLoginContext, mockUser, mockWorkspace } from '@tests/fixtures'
import { emptyPage, mockFormDef, mockOrgMember2, mockStatus, mockTask, mockTaskDetail } from '@tests/mockData'
import { renderWithProviders } from '@tests/renderWithProviders'
import { setupPopulatedApiMock, setupPopulatedQueryMocks, resetQueryMocks } from '@tests/smokeMocks'
import { useAuthStore } from '@/stores/auth'

import { useProject, useProjectTasks, useSprints, useStatuses, useWorkspaceDashboard } from '@/lib/queries'
import { mockProject } from '@tests/fixtures'
import { mockWorkspaceDashboard } from '@tests/mockData'

// Pages lazy-loaded per test — avoids loading the full app tree at collect time.

describe('uncovered page smoke renders', () => {
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
    setupPopulatedQueryMocks()
    vi.mocked(useProject).mockReturnValue({
      data: mockProject,
      isLoading: false,
    } as ReturnType<typeof useProject>)
    vi.mocked(useStatuses).mockReturnValue({
      data: [mockStatus],
      isLoading: false,
    } as ReturnType<typeof useStatuses>)
    vi.mocked(useSprints).mockReturnValue({
      data: [],
      isLoading: false,
    } as ReturnType<typeof useSprints>)
    vi.mocked(useProjectTasks).mockReturnValue({
      data: { items: [mockTask()], total: 1, page: 1, page_size: 50 },
      isLoading: false,
    } as ReturnType<typeof useProjectTasks>)
    setupPopulatedApiMock()
    vi.mocked(api.get).mockImplementation(async (url: string) => {
      if (url.includes('/tasks/task-1/sprints')) return []
      if (url.includes('/tasks/task-1')) return mockTaskDetail()
      if (url.includes('/sprints')) return []
      if (url.includes('/comments')) return { ...emptyPage, page_size: 200 }
      if (url.includes('/custom-fields')) return []
      if (url.includes('/time-entries')) return emptyPage
      if (url === '/forms/form-1' || url.includes('/forms/form-1')) return mockFormDef()
      if (url.includes('/forms/')) return mockFormDef()
      if (url.includes('/whiteboards/wb-1')) {
        return {
          id: 'wb-1',
          workspace_id: 'ws-1',
          name: 'Sprint Board',
          created_by: 'user-1',
          created_at: '2024-01-01T00:00:00Z',
          updated_at: '2024-01-01T00:00:00Z',
          element_count: 0,
          creator: null,
          content: { elements: [], files: {}, appState: {} },
        }
      }
      if (url.includes('/workspaces/ws-1/members')) return []
      if (url.includes('/workspaces/ws-1')) return mockWorkspace
      if (url.includes('/projects/proj-1/members')) return []
      if (url.includes('/admin/stats')) {
        return { organizations: 1, active_organizations: 1, users: 5, workspaces: 2 }
      }
      if (url.includes('/admin/audit-logs')) return emptyPage
      if (url.includes('/admin/cron-logs')) return emptyPage
      if (url.includes('/admin/organizations')) return { ...emptyPage, page_size: 25 }
      if (url.includes('/github/projects') && url.includes('/repositories')) return []
      if (url.includes('/github/tasks')) return { branch_name: 'main' }
      if (url.includes('/github/')) return emptyPage
      return {}
    })
  })

  it('TaskPage', async () => {
    const { default: TaskPage } = await import('@/pages/app/TaskPage')
    renderWithProviders(
      <Routes>
        <Route path="/app/tasks/:taskId" element={<TaskPage />} />
      </Routes>,
      { routerProps: { initialEntries: ['/app/tasks/task-1'] } },
    )
    expect(await screen.findByRole('heading', { name: 'Fix bug' })).toBeInTheDocument()
  })

  it('ProjectPage', async () => {
    const { default: ProjectPage } = await import('@/pages/app/ProjectPage')
    renderWithProviders(
      <Routes>
        <Route path="/app/projects/:projectId" element={<ProjectPage />} />
      </Routes>,
      { routerProps: { initialEntries: ['/app/projects/proj-1'] } },
    )
    expect(await screen.findByText('Alpha Project')).toBeInTheDocument()
    expect(screen.getByText('Fix bug')).toBeInTheDocument()
  })

  it('ProjectPage board view', async () => {
    const { default: ProjectPage } = await import('@/pages/app/ProjectPage')
    renderWithProviders(
      <Routes>
        <Route path="/app/projects/:projectId" element={<ProjectPage />} />
      </Routes>,
      { routerProps: { initialEntries: ['/app/projects/proj-1?view=board'] } },
    )
    await waitFor(() => {
      expect(screen.getAllByText('Alpha Project').length).toBeGreaterThan(0)
    })
    expect(screen.getByText('Open')).toBeInTheDocument()
  })

  it('FormBuilderPage', async () => {
    const { default: FormBuilderPage } = await import('@/pages/app/FormBuilderPage')
    vi.mocked(api.get).mockResolvedValueOnce(mockFormDef())
    renderWithProviders(
      <Routes>
        <Route path="/app/forms/:formId" element={<FormBuilderPage />} />
      </Routes>,
      { routerProps: { initialEntries: ['/app/forms/form-1'] } },
    )
    expect((await screen.findAllByRole('heading', { name: 'Feedback Form' })).length).toBeGreaterThan(0)
  })

  it('FormFillPage', async () => {
    const { default: FormFillPage } = await import('@/pages/app/FormFillPage')
    renderWithProviders(
      <Routes>
        <Route path="/app/forms/:formId/fill" element={<FormFillPage />} />
      </Routes>,
      { routerProps: { initialEntries: ['/app/forms/form-1/fill'] } },
    )
    expect(await screen.findByText('Feedback Form')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Submit' })).toBeInTheDocument()
  })

  it('WhiteboardsPage with boards', async () => {
    const { default: WhiteboardsPage } = await import('@/pages/app/WhiteboardsPage')
    renderWithProviders(<WhiteboardsPage />)
    expect(await screen.findByRole('heading', { name: 'All Whiteboards' })).toBeInTheDocument()
    expect(screen.getByText('Sprint Board')).toBeInTheDocument()
  })

  it('WhiteboardCanvasPage', async () => {
    const { default: WhiteboardCanvasPage } = await import('@/pages/app/WhiteboardCanvasPage')
    vi.mocked(api.get).mockImplementation(async (url: string) => {
      if (url === '/whiteboards/wb-1') {
        return {
          id: 'wb-1',
          workspace_id: 'ws-1',
          name: 'Sprint Board',
          created_by: 'user-1',
          created_at: '2024-01-01T00:00:00Z',
          updated_at: '2024-01-01T00:00:00Z',
          element_count: 0,
          creator: null,
          content: { elements: [], files: {}, appState: {} },
        }
      }
      return {}
    })
    renderWithProviders(
      <Routes>
        <Route path="/app/whiteboards/:whiteboardId" element={<WhiteboardCanvasPage />} />
      </Routes>,
      { routerProps: { initialEntries: ['/app/whiteboards/wb-1'] } },
    )
    expect(await screen.findByDisplayValue('Sprint Board')).toBeInTheDocument()
  })

  it('WorkspaceDetailPage', async () => {
    const { default: WorkspaceDetailPage } = await import('@/pages/app/WorkspaceDetailPage')
    vi.mocked(useWorkspaceDashboard).mockReturnValue({
      data: mockWorkspaceDashboard(),
      isLoading: false,
    } as ReturnType<typeof useWorkspaceDashboard>)
    renderWithProviders(
      <Routes>
        <Route path="/app/workspaces/:workspaceId" element={<WorkspaceDetailPage />} />
      </Routes>,
      { routerProps: { initialEntries: ['/app/workspaces/ws-1'] } },
    )
    expect(await screen.findByText('Workspace overview')).toBeInTheDocument()
  })

  it('DashboardPage', async () => {
    const { default: DashboardPage } = await import('@/pages/app/DashboardPage')
    renderWithProviders(<DashboardPage />)
    expect(await screen.findByRole('heading', { name: 'Main Workspace' })).toBeInTheDocument()
  })

  it('TaskPage shows checklists and fields', async () => {
    const { default: TaskPage } = await import('@/pages/app/TaskPage')
    vi.mocked(api.get).mockImplementation(async (url: string) => {
      if (url.includes('/tasks/task-1/sprints')) return []
      if (url.includes('/tasks/task-1')) {
        return mockTaskDetail({
          checklists: [
            {
              id: 'cl-1',
              name: 'QA checklist',
              position: 0,
              items: [{ id: 'cli-1', content: 'Run tests', is_done: false, position: 0 }],
            },
          ],
        })
      }
      if (url.includes('/comments')) return { ...emptyPage, page_size: 200 }
      if (url.includes('/custom-fields')) return []
      if (url.includes('/time-entries')) return emptyPage
      if (url.includes('/github/projects') && url.includes('/repositories')) return []
      if (url.includes('/github/tasks')) return { branch_name: 'main' }
      if (url.includes('/github/')) return []
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
      return {}
    })
    renderWithProviders(
      <Routes>
        <Route path="/app/tasks/:taskId" element={<TaskPage />} />
      </Routes>,
      { routerProps: { initialEntries: ['/app/tasks/task-1'] } },
    )
    expect(await screen.findByRole('heading', { name: 'Fix bug' })).toBeInTheDocument()
    expect(await screen.findByText('QA checklist')).toBeInTheDocument()
    expect(screen.getByText('Run tests')).toBeInTheDocument()
  })

  it('PlatformAdminPage', async () => {
    const { default: PlatformAdminPage } = await import('@/pages/admin/PlatformAdminPage')
    renderWithProviders(<PlatformAdminPage />)
    expect(await screen.findByRole('heading', { name: 'Platform overview' })).toBeInTheDocument()
  })

  it('OrganizationsAdminPage', async () => {
    const { default: OrganizationsAdminPage } = await import('@/pages/admin/OrganizationsAdminPage')
    renderWithProviders(<OrganizationsAdminPage />)
    expect(await screen.findByRole('heading', { name: 'Organizations' })).toBeInTheDocument()
  })
})

describe('uncovered page smoke interactions', () => {
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
    setupPopulatedQueryMocks()
    vi.mocked(useProject).mockReturnValue({
      data: mockProject,
      isLoading: false,
    } as ReturnType<typeof useProject>)
    vi.mocked(useStatuses).mockReturnValue({
      data: [mockStatus],
      isLoading: false,
    } as ReturnType<typeof useStatuses>)
    vi.mocked(useSprints).mockReturnValue({
      data: [],
      isLoading: false,
    } as ReturnType<typeof useSprints>)
    vi.mocked(useProjectTasks).mockReturnValue({
      data: { items: [mockTask()], total: 1, page: 1, page_size: 50 },
      isLoading: false,
    } as ReturnType<typeof useProjectTasks>)
    setupPopulatedApiMock()
    vi.mocked(api.get).mockImplementation(async (url: string) => {
      if (url.includes('/tasks/task-1/sprints')) return []
      if (url.includes('/tasks/task-1')) return mockTaskDetail()
      if (url.includes('/comments')) return { ...emptyPage, page_size: 200 }
      if (url.includes('/custom-fields')) return []
      if (url.includes('/github/projects') && url.includes('/repositories')) return []
      if (url.includes('/github/tasks')) return { branch_name: 'main' }
      if (url.includes('/github/')) return emptyPage
      if (url.includes('/activity')) return emptyPage
      if (url.includes('/members')) return []
      return {}
    })
  })

  it('TaskPage opens assignee picker', async () => {
    const user = userEvent.setup()
    const { default: TaskPage } = await import('@/pages/app/TaskPage')
    vi.mocked(api.get).mockImplementation(async (url: string) => {
      if (url.includes('/tasks/task-1/sprints')) return []
      if (url.includes('/tasks/task-1')) return mockTaskDetail()
      if (url.includes('/comments')) return { ...emptyPage, page_size: 200 }
      if (url.includes('/custom-fields')) return []
      if (url.includes('/projects/proj-1/members')) return [mockOrgMember2()]
      if (url.includes('/github/projects') && url.includes('/repositories')) return []
      if (url.includes('/github/tasks')) return { branch_name: 'main' }
      if (url.includes('/github/')) return []
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
      return {}
    })
    renderWithProviders(
      <Routes>
        <Route path="/app/tasks/:taskId" element={<TaskPage />} />
      </Routes>,
      { routerProps: { initialEntries: ['/app/tasks/task-1'] } },
    )
    await screen.findByRole('heading', { name: 'Fix bug' })
    await user.click(await screen.findByText('+ Assign'))
    expect(await screen.findByText('Jane Doe')).toBeInTheDocument()
  })

  it('ProjectPage switches to calendar view', async () => {
    const user = userEvent.setup()
    const { default: ProjectPage } = await import('@/pages/app/ProjectPage')
    renderWithProviders(
      <Routes>
        <Route path="/app/projects/:projectId" element={<ProjectPage />} />
      </Routes>,
      { routerProps: { initialEntries: ['/app/projects/proj-1'] } },
    )
    await waitFor(() => {
      expect(screen.getAllByText('Alpha Project').length).toBeGreaterThan(0)
    })
    await user.click(screen.getByRole('button', { name: 'Calendar' }))
    expect(screen.getByRole('button', { name: /today/i })).toBeInTheDocument()
  })
})
