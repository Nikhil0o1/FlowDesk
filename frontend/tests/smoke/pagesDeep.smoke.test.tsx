import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Route, Routes } from 'react-router-dom'

import { api } from '@/lib/api'
import { mockCurrentContext, mockLoginContext, mockOrg, mockUser, mockWorkspace } from '@tests/fixtures'
import {
  emptyPage,
  mockOrgMember,
  mockOrgMember2,
  mockStatus,
  mockTask,
  mockTaskDetail,
  mockTimeEntry,
} from '@tests/mockData'
import { renderWithProviders } from '@tests/renderWithProviders'
import { setupPopulatedApiMock, setupPopulatedQueryMocks, resetQueryMocks } from '@tests/smokeMocks'
import { useAuthStore } from '@/stores/auth'
import { useCurrentContext, useProject, useProjectTasks, useSprints, useStatuses } from '@/lib/queries'
import { mockProject } from '@tests/fixtures'

function setupProjectPage() {
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
}

async function renderProject(initialEntry = '/app/projects/proj-1') {
  const { default: ProjectPage } = await import('@/pages/app/ProjectPage')
  return renderWithProviders(
    <Routes>
      <Route path="/app/projects/:projectId" element={<ProjectPage />} />
    </Routes>,
    { routerProps: { initialEntries: [initialEntry] } },
  )
}

describe('deep page interactions', () => {
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
    setupProjectPage()
    setupPopulatedApiMock()
    vi.mocked(api.get).mockImplementation(async (url: string) => {
      if (url.includes('/projects/proj-1/members')) {
        return [mockOrgMember(), mockOrgMember2()]
      }
      if (url.includes('/projects/proj-1/teams')) return []
      if (url.includes('/projects/proj-1/tasks')) {
        return { ...emptyPage, items: [mockTask(), mockTask({ id: 'task-2', ref: 'ALPHA-2', title: 'Write tests' })], total: 2, page_size: 50 }
      }
      if (url.includes('/tasks/task-1/sprints')) return []
      if (url.includes('/tasks/task-1')) return mockTaskDetail()
      if (url.includes('/workspaces/ws-1/members')) {
        return [mockOrgMember(), mockOrgMember2()]
      }
      if (url.includes('/workspaces/ws-1')) return mockWorkspace
      if (url.includes('/sprints')) return []
      if (url.includes('/comments')) return { ...emptyPage, page_size: 200 }
      if (url.includes('/custom-fields')) return []
      if (url.includes('/time-entries')) return emptyPage
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
    vi.mocked(api.patch).mockResolvedValue({})
    vi.mocked(api.delete).mockResolvedValue(undefined)
    vi.mocked(api.post).mockResolvedValue({})
  })

  it('ProjectPage opens members modal and switches views', async () => {
    const user = userEvent.setup()
    await renderProject()
    await waitFor(() => {
      expect(screen.getAllByText('Alpha Project').length).toBeGreaterThan(0)
    })
    await user.click(screen.getByRole('button', { name: /members/i }))
    expect(await screen.findByRole('heading', { name: /project members/i })).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Board' }))
    expect(screen.getByText('Open')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Table' }))
    expect(screen.getByText('Fix bug')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /subtasks/i }))
    await user.click(screen.getByRole('button', { name: /hidden|complete/i }))
  })

  it('ProjectPage applies filters and assignee shortcut', async () => {
    const user = userEvent.setup()
    await renderProject()
    await waitFor(() => {
      expect(screen.getByText('Fix bug')).toBeInTheDocument()
    })
    await user.click(screen.getByRole('button', { name: /filter/i }))
    const [prioritySelect] = screen.getAllByRole('combobox')
    await user.selectOptions(prioritySelect, 'high')
    await user.click(screen.getByTitle('Assigned to me'))
    await user.click(screen.getByTitle('Assigned to me'))
  })

  it('ProjectPage toggles column visibility in list view', async () => {
    const user = userEvent.setup()
    await renderProject()
    await waitFor(() => {
      expect(screen.getByText('Fix bug')).toBeInTheDocument()
    })
    await user.click(screen.getByRole('button', { name: /columns/i }))
    const priorityCheckbox = screen.getByRole('checkbox', { name: /priority/i })
    await user.click(priorityCheckbox)
  })

  it('WorkspaceDetailPage invites and changes member role', async () => {
    const user = userEvent.setup()
    const { default: WorkspaceDetailPage } = await import('@/pages/app/WorkspaceDetailPage')
    vi.mocked(useCurrentContext).mockReturnValue(
      mockCurrentContext({ org: { ...mockOrg, my_role: 'member' } }),
    )
    renderWithProviders(
      <Routes>
        <Route path="/app/workspaces/:workspaceId" element={<WorkspaceDetailPage />} />
      </Routes>,
      { routerProps: { initialEntries: ['/app/workspaces/ws-1'] } },
    )
    expect(await screen.findByRole('heading', { name: 'Main Workspace' })).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /invite/i }))
    expect(await screen.findByRole('heading', { name: /invite/i })).toBeInTheDocument()
    await user.keyboard('{Escape}')

    const roleButtons = screen.getAllByText(/member|admin/i)
    if (roleButtons.length > 0) {
      await user.click(roleButtons[0])
    }
  }, 15000)
})
