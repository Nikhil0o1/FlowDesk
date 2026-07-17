import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { api } from '@/lib/api'
import { toast } from '@/stores/toast'
import { mockStatus, mockStatusDone, mockTask } from '@tests/mockData'
import { renderWithProviders } from '@tests/renderWithProviders'
import { KanbanBoard } from '@/components/tasks/KanbanBoard'

vi.mock('@/stores/toast', () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() },
}))

vi.mock('@/lib/taskMutations', () => ({
  useTaskPatch: vi.fn(() => ({ mutate: vi.fn(), isPending: false })),
  withDueDate: vi.fn(),
  withPriority: vi.fn(),
  withStatus: vi.fn((status) => ({ status })),
}))

describe('KanbanBoard', () => {
  beforeEach(() => {
    vi.mocked(toast.success).mockReset()
    vi.mocked(toast.error).mockReset()
    vi.mocked(api.get).mockResolvedValue({
      is_private: false,
      public_enabled: false,
      public_url: null,
      public_expires_at: null,
      public_searchable: false,
      members: [],
    })
    vi.mocked(api.patch).mockResolvedValue({})
    vi.mocked(api.post).mockResolvedValue(mockTask())
    vi.mocked(api.delete).mockResolvedValue(undefined)
  })

  it('renders tasks in status columns', async () => {
    renderWithProviders(
      <KanbanBoard
        projectId="proj-1"
        tasks={[mockTask(), mockTask({ id: 'task-2', title: 'Write tests', status: mockStatusDone })]}
        statuses={[mockStatus, mockStatusDone]}
        canEdit
        canEditTask={() => true}
      />,
    )
    expect(await screen.findByText('Fix bug')).toBeInTheDocument()
    expect(screen.getByText('Write tests')).toBeInTheDocument()
    expect(screen.getByText('Open')).toBeInTheDocument()
    expect(screen.getByText('Done')).toBeInTheDocument()
  })

  it('opens card menu and share modal', async () => {
    const user = userEvent.setup()
    renderWithProviders(
      <KanbanBoard
        projectId="proj-1"
        tasks={[mockTask()]}
        statuses={[mockStatus]}
        canEdit
        canEditTask={() => true}
      />,
    )
    await screen.findByText('Fix bug')
    await user.click(screen.getByTitle('More actions'))
    await user.click(screen.getByRole('button', { name: /Sharing & permissions/i }))
    expect(await screen.findByRole('heading', { name: 'Share this task' })).toBeInTheDocument()
  })

  it('shows quick add in column when editable', async () => {
    const user = userEvent.setup()
    renderWithProviders(
      <KanbanBoard
        projectId="proj-1"
        tasks={[]}
        statuses={[mockStatus]}
        canEdit
      />,
    )
    await user.click(screen.getByTitle('Add task'))
    expect(screen.getByPlaceholderText(/task name/i)).toBeInTheDocument()
  })

  it('links quick-added tasks to the sprint and confirms creation', async () => {
    const user = userEvent.setup()
    vi.mocked(api.post)
      .mockResolvedValueOnce(mockTask({ id: 'task-new', ref: 'FD-9' }))
      .mockResolvedValueOnce(undefined)

    renderWithProviders(
      <KanbanBoard
        projectId="proj-1"
        sprintId="sprint-1"
        tasks={[]}
        statuses={[mockStatus]}
        canEdit
        taskListQueryKey={['sprint-tasks', 'sprint-1']}
      />,
    )

    await user.click(screen.getByTitle('Add task'))
    await user.type(screen.getByPlaceholderText(/task name/i), 'Sprint task')
    await user.keyboard('{Enter}')

    expect(api.post).toHaveBeenNthCalledWith(
      1,
      '/projects/proj-1/tasks',
      expect.objectContaining({ title: 'Sprint task', status_id: mockStatus.id }),
    )
    expect(api.post).toHaveBeenNthCalledWith(2, '/sprints/sprint-1/tasks', { task_ids: ['task-new'] })
    expect(toast.success).toHaveBeenCalledWith('FD-9 created and added to sprint')
  })

  it('starts timer with an empty JSON body from the card menu', async () => {
    const user = userEvent.setup()
    vi.mocked(api.get).mockImplementation((path: string) => {
      if (path === '/timer/current') return Promise.resolve(null)
      return Promise.resolve({
        is_private: false,
        public_enabled: false,
        public_url: null,
        public_expires_at: null,
        public_searchable: false,
        members: [],
      })
    })

    renderWithProviders(
      <KanbanBoard
        projectId="proj-1"
        tasks={[mockTask()]}
        statuses={[mockStatus]}
        canEdit
        canEditTask={() => true}
      />,
    )

    await screen.findByText('Fix bug')
    await user.click(screen.getByTitle('More actions'))
    await user.click(screen.getByRole('button', { name: /Start timer/i }))

    expect(api.post).toHaveBeenCalledWith('/tasks/task-1/timer/start', {})
    expect(toast.success).toHaveBeenCalledWith('Timer started')
  })

  it('respects read-only mode', () => {
    renderWithProviders(
      <KanbanBoard
        projectId="proj-1"
        tasks={[mockTask()]}
        statuses={[mockStatus]}
        canEdit={false}
      />,
    )
    expect(screen.queryByTitle('Add task')).not.toBeInTheDocument()
  })
})
