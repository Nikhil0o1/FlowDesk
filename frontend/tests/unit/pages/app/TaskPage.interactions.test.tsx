import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Route, Routes } from 'react-router-dom'

import { api } from '@/lib/api'
import { mockCurrentContext, mockProject, mockUser } from '@tests/fixtures'
import { emptyPage, mockStatus, mockTask, mockTaskDetail, mockTimeEntry } from '@tests/mockData'
import { renderWithProviders } from '@tests/renderWithProviders'
import { setupPopulatedApiMock, resetQueryMocks } from '@tests/smokeMocks'
import { useAuthStore } from '@/stores/auth'
import TaskPage from '@/pages/app/TaskPage'
import { useProject, useRunningTimer, useSprints, useStatuses } from '@/lib/queries'
import { useTaskPatch } from '@/lib/taskMutations'

const mutateTask = vi.fn()

vi.mock('@/lib/taskMutations', () => ({
  useTaskPatch: vi.fn(() => ({ mutate: mutateTask, isPending: false })),
  withDueDate: vi.fn(),
  withPriority: vi.fn(),
  withStatus: vi.fn((status) => ({ status })),
}))

function setupTaskPageMocks() {
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
  vi.mocked(useRunningTimer).mockReturnValue({
    data: null,
    isLoading: false,
  } as ReturnType<typeof useRunningTimer>)
  vi.mocked(api.get).mockImplementation(async (url: string) => {
    if (url.includes('/tasks/task-1/sprints')) return []
    if (url.includes('/tasks/task-1/time-entries')) {
      return { ...emptyPage, items: [], page_size: 20 }
    }
    if (url.includes('/tasks/task-1/comments')) {
      return { ...emptyPage, items: [], page_size: 200 }
    }
    if (url.includes('/tasks/task-1')) {
      return mockTaskDetail({
        subtasks: [
          {
            ...mockTask({ id: 'sub-1', ref: 'ALPHA-2', title: 'Child task', parent_task_id: 'task-1' }),
            assignees: [],
          },
        ],
      })
    }
    if (url.includes('/sprints')) return []
    if (url.includes('/custom-fields')) return []
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
    if (url.includes('/search')) return { tasks: [], projects: [], users: [] }
    return {}
  })
  vi.mocked(api.post).mockResolvedValue(mockTask())
  vi.mocked(api.patch).mockResolvedValue(mockTaskDetail())
  vi.mocked(api.delete).mockResolvedValue(undefined)
}

function renderTaskPage() {
  return renderWithProviders(
    <Routes>
      <Route path="/app/tasks/:taskId" element={<TaskPage />} />
    </Routes>,
    { routerProps: { initialEntries: ['/app/tasks/task-1'] } },
  )
}

describe('TaskPage interactions', () => {
  afterEach(() => {
    resetQueryMocks()
  })

  beforeEach(() => {
    mutateTask.mockClear()
    vi.mocked(useTaskPatch).mockReturnValue({
      mutate: mutateTask,
      isPending: false,
    } as ReturnType<typeof useTaskPatch>)
    useAuthStore.setState({
      user: mockUser,
      loginContext: null,
      initialized: true,
      accessToken: 'test-token',
    })
    setupPopulatedApiMock()
    setupTaskPageMocks()
  })

  it('edits title and description', async () => {
    const user = userEvent.setup()
    renderTaskPage()
    const heading = await screen.findByRole('heading', { name: 'Fix bug' })
    await user.click(heading)
    const input = screen.getByDisplayValue('Fix bug')
    await user.clear(input)
    await user.type(input, 'Updated title')
    await user.tab()
    expect(mutateTask).toHaveBeenCalled()

    await user.click(screen.getByText(/add a description/i))
    const desc = screen.getByPlaceholderText(/add a description/i)
    await user.type(desc, 'More detail')
    await user.click(screen.getByRole('button', { name: 'Save' }))
    expect(mutateTask).toHaveBeenCalledTimes(2)
  })

  it('adds a subtask and starts timer', async () => {
    const user = userEvent.setup()
    renderTaskPage()
    await screen.findByRole('heading', { name: 'Fix bug' })
    expect(screen.getByText('Child task')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /add subtask/i }))
    await user.type(screen.getByPlaceholderText(/subtask name/i), 'New subtask')
    await user.keyboard('{Enter}')
    expect(api.post).toHaveBeenCalled()
    await user.click(screen.getByRole('button', { name: /start timer/i }))
    expect(api.post).toHaveBeenCalledWith('/tasks/task-1/timer/start', {})
  })

  it('adds dependency and manages attachments', async () => {
    const user = userEvent.setup()
    vi.mocked(api.get).mockImplementation(async (url: string) => {
      if (url.includes('/tasks/task-1/sprints')) return []
      if (url.includes('/tasks/task-1/time-entries')) {
        return { ...emptyPage, items: [mockTimeEntry()], page_size: 20 }
      }
      if (url.includes('/tasks/task-1/comments')) {
        return { ...emptyPage, items: [], page_size: 200 }
      }
      if (url.includes('/tasks/task-1')) {
        return mockTaskDetail({
          attachments: [
            {
              id: 'att-1',
              file_name: 'screenshot.png',
              mime_type: 'image/png',
              size_bytes: 1024,
              created_at: '2024-01-01T00:00:00Z',
              uploader: { id: 'user-1', full_name: 'Test User', email: 'test@example.com', avatar_url: null },
            },
          ],
        })
      }
      if (url.includes('/projects/proj-1/tasks?q=')) {
        return { ...emptyPage, items: [mockTask({ id: 'task-2', ref: 'ALPHA-2', title: 'Blocker task' })], page_size: 8 }
      }
      if (url.includes('/attachments/att-1/download')) return new Blob(['x'], { type: 'image/png' })
      if (url.includes('/sprints')) return []
      if (url.includes('/custom-fields')) return []
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
      if (url.includes('/search')) return { tasks: [], projects: [], users: [] }
      return {}
    })
    renderTaskPage()
    await screen.findByRole('heading', { name: 'Fix bug' })

    await user.click(screen.getByText(/add dependency/i))
    const depInput = screen.getByPlaceholderText(/search tasks this depends on/i)
    await user.type(depInput, 'Block')
    const depOption = await screen.findByText('Blocker task')
    await user.click(depOption)
    expect(api.post).toHaveBeenCalledWith('/tasks/task-1/dependencies', { depends_on_task_id: 'task-2' })

    URL.createObjectURL = vi.fn(() => 'blob:mock') as unknown as typeof URL.createObjectURL
    URL.revokeObjectURL = vi.fn() as unknown as typeof URL.revokeObjectURL

    await user.click(screen.getByTitle('Download'))
    expect(api.get).toHaveBeenCalledWith('/attachments/att-1/download')

    // Preview streams the file through /download and renders it inline (no new tab).
    await user.click(screen.getByTitle('Preview'))
    expect(await screen.findByAltText('screenshot.png')).toBeInTheDocument()
  })

  it('stops a running timer', async () => {
    const user = userEvent.setup()
    vi.mocked(useRunningTimer).mockReturnValue({
      data: { task_id: 'task-1', started_at: '2024-01-01T00:00:00Z' },
      isLoading: false,
    } as ReturnType<typeof useRunningTimer>)
    renderTaskPage()
    await screen.findByRole('heading', { name: 'Fix bug' })
    await user.click(screen.getByRole('button', { name: /stop timer/i }))
    expect(api.post).toHaveBeenCalledWith('/timer/stop')
  })

  it('opens assignee picker and adds label', async () => {
    const user = userEvent.setup()
    vi.mocked(api.get).mockImplementation(async (url: string) => {
      if (url.includes('/projects/proj-1/members')) {
        return [
          {
            user_id: 'user-2',
            user: { id: 'user-2', full_name: 'Jane Doe', email: 'jane@example.com', avatar_url: null },
          },
        ]
      }
      if (url.includes('/tasks/task-1/sprints')) return []
      if (url.includes('/tasks/task-1/time-entries')) {
        return { ...emptyPage, items: [], page_size: 20 }
      }
      if (url.includes('/tasks/task-1/comments')) {
        return { ...emptyPage, items: [], page_size: 200 }
      }
      if (url.includes('/tasks/task-1')) return mockTaskDetail()
      if (url.includes('/sprints')) return []
      if (url.includes('/custom-fields')) return []
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
      if (url.includes('/search')) return { tasks: [], projects: [], users: [] }
      return {}
    })
    renderTaskPage()
    await screen.findByRole('heading', { name: 'Fix bug' })
    await user.click(screen.getByText('+ Assign'))
    expect(await screen.findByText('Jane Doe')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /^add$/i }))
    const tagInput = document.querySelector('input[class*="text-\\[11px\\]"]') as HTMLInputElement
    await user.type(tagInput, 'backend')
    await user.keyboard('{Enter}')
    expect(mutateTask).toHaveBeenCalled()
  })
})
