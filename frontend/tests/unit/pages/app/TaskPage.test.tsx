import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { Route, Routes } from 'react-router-dom'

import { api } from '@/lib/api'
import { mockCurrentContext, mockProject, mockUser } from '@tests/fixtures'
import { emptyPage, mockTaskDetail } from '@tests/mockData'
import { renderWithProviders } from '@tests/renderWithProviders'
import { useAuthStore } from '@/stores/auth'
import TaskPage from '@/pages/app/TaskPage'
import { useProject, useSprints, useStatuses } from '@/lib/queries'
import { mockStatus } from '@tests/mockData'

vi.mock('@/lib/taskMutations', () => ({
  useTaskPatch: vi.fn(() => ({ mutate: vi.fn(), isPending: false })),
  withDueDate: vi.fn(),
  withPriority: vi.fn(),
  withStatus: vi.fn(),
}))

describe('TaskPage', () => {
  beforeEach(() => {
    useAuthStore.setState({
      user: mockUser,
      loginContext: null,
      initialized: true,
      accessToken: 'test-token',
    })
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
    vi.mocked(api.get).mockImplementation(async (url: string) => {
      if (url.includes('/tasks/task-1/sprints')) return []
      if (url.includes('/tasks/task-1')) return mockTaskDetail()
      if (url.includes('/sprints')) return []
      if (url.includes('/comments')) return { ...emptyPage, page_size: 200 }
      if (url.includes('/custom-fields')) return []
      if (url.includes('/time-entries')) return emptyPage
      if (url.includes('/github/projects') && url.includes('/repositories')) return []
      if (url.includes('/github/tasks')) return []
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
  })

  it('renders task details', async () => {
    renderWithProviders(
      <Routes>
        <Route path="/app/tasks/:taskId" element={<TaskPage />} />
      </Routes>,
      { routerProps: { initialEntries: ['/app/tasks/task-1'] } },
    )
    expect(await screen.findByRole('heading', { name: 'Fix bug' })).toBeInTheDocument()
    expect(screen.getByText('ALPHA-1')).toBeInTheDocument()
  })

  it('opens share modal', async () => {
    const user = userEvent.setup()
    renderWithProviders(
      <Routes>
        <Route path="/app/tasks/:taskId" element={<TaskPage />} />
      </Routes>,
      { routerProps: { initialEntries: ['/app/tasks/task-1'] } },
    )
    await screen.findByRole('heading', { name: 'Fix bug' })
    await user.click(screen.getByRole('button', { name: /^Share$/i }))
    expect(await screen.findByRole('heading', { name: 'Share this task' })).toBeInTheDocument()
  })
})
