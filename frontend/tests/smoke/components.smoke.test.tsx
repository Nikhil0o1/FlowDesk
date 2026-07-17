import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'

import { api } from '@/lib/api'
import { mockUser, mockProject } from '@tests/fixtures'
import { mockOrgMember } from '@tests/mockData'
import { emptyPage, mockFormDef, mockStatus, mockTask, mockTaskDetail, mockUserBrief } from '@tests/mockData'
import { renderWithProviders } from '@tests/renderWithProviders'
import { setupPopulatedApiMock, resetQueryMocks } from '@tests/smokeMocks'
import { useAuthStore } from '@/stores/auth'
import { useStatuses, useProject } from '@/lib/queries'

vi.mock('@/stores/toast', () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() },
}))

vi.mock('@/lib/taskMutations', () => ({
  useTaskPatch: vi.fn(() => ({ mutate: vi.fn(), mutateAsync: vi.fn(), isPending: false })),
  withDueDate: vi.fn((due_date: string | null) => (task: { due_date: string | null }) => ({ ...task, due_date })),
  withPriority: vi.fn((priority: unknown) => (task: { priority: unknown }) => ({ ...task, priority })),
  withStatus: vi.fn((status: unknown) => (task: { status: unknown }) => ({ ...task, status })),
}))

// Components are loaded per-test via dynamic import so Vitest does not parse
// the entire component tree up front (~30s collect) before the first assertion.

describe('component smoke renders', () => {
  afterEach(() => {
    resetQueryMocks()
  })

  beforeEach(() => {
    useAuthStore.setState({
      user: mockUser,
      loginContext: null,
      initialized: true,
      accessToken: 'test-token',
    })
    setupPopulatedApiMock()
    vi.mocked(api.get).mockImplementation(async (url: string) => {
      if (url.includes('/timer/current')) return null
      if (url.includes('/comments')) return { ...emptyPage, page_size: 200 }
      if (url.includes('/custom-fields')) return []
      if (url.includes('/members')) return [mockOrgMember()]
      if (url.includes('/teams')) return []
      if (url.includes('/github/')) return emptyPage
      if (url.includes('/activity')) {
        return {
          ...emptyPage,
          items: [
            {
              id: 'act-1',
              action: 'task.created',
              entity_type: 'task',
              entity_id: 'task-1',
              data: { title: 'Fix bug' },
              created_at: '2024-06-01T10:00:00Z',
              actor: mockUserBrief,
            },
          ],
          total: 1,
          page_size: 80,
        }
      }
      if (url.includes('/search')) return { tasks: [], projects: [], users: [] }
      if (url.includes('/notifications')) return { ...emptyPage, page_size: 8 }
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
    vi.mocked(useStatuses).mockReturnValue({
      data: [mockStatus],
      isLoading: false,
    } as ReturnType<typeof useStatuses>)
    vi.mocked(useProject).mockReturnValue({
      data: mockProject,
      isLoading: false,
    } as ReturnType<typeof useProject>)
  })

  it('KanbanBoard', async () => {
    const { KanbanBoard } = await import('@/components/tasks/KanbanBoard')
    renderWithProviders(
      <KanbanBoard
        projectId="proj-1"
        tasks={[mockTask()]}
        statuses={[mockStatus]}
        canEdit
        canEditTask={() => true}
      />,
    )
    expect(await screen.findByText('Fix bug')).toBeInTheDocument()
    expect(screen.getByText('Open')).toBeInTheDocument()
  })

  it('TaskTable', async () => {
    const { TaskTable } = await import('@/components/tasks/TaskTable')
    renderWithProviders(
      <TaskTable
        projectId="proj-1"
        tasks={[mockTask()]}
        statuses={[mockStatus]}
        cols={['status', 'priority', 'assignee', 'due', 'comments']}
        canEdit
      />,
    )
    expect(screen.getByText('Fix bug')).toBeInTheDocument()
  })

  it('TableView', async () => {
    const { TableView } = await import('@/components/tasks/TableView')
    renderWithProviders(<TableView projectId="proj-1" tasks={[mockTask()]} canEdit />)
    expect(screen.getByText('Name')).toBeInTheDocument()
  })

  it('CalendarView', async () => {
    const { CalendarView } = await import('@/components/tasks/CalendarView')
    renderWithProviders(<CalendarView projectId="proj-1" tasks={[mockTask()]} canEdit />)
    expect(screen.getByRole('button', { name: /today/i })).toBeInTheDocument()
  })

  it('GanttView', async () => {
    const { GanttView } = await import('@/components/tasks/GanttView')
    renderWithProviders(
      <GanttView projectId="proj-1" projectName="Alpha" tasks={[mockTask()]} canEdit />,
    )
    expect(screen.getByText('Alpha')).toBeInTheDocument()
  })

  it('CommentSection', async () => {
    const { CommentSection } = await import('@/components/comments/CommentSection')
    renderWithProviders(<CommentSection taskId="task-1" projectId="proj-1" />)
    expect(await screen.findByPlaceholderText(/comment/i)).toBeInTheDocument()
  })

  it('Checklists', async () => {
    const { Checklists } = await import('@/components/tasks/Checklists')
    renderWithProviders(<Checklists task={mockTaskDetail()} />)
    expect(screen.getByRole('heading', { name: 'Checklists' })).toBeInTheDocument()
  })

  it('CustomFields', async () => {
    const { CustomFields } = await import('@/components/tasks/CustomFields')
    renderWithProviders(<CustomFields task={mockTaskDetail()} canManage />)
    await waitFor(() => {
      expect(screen.getByText(/custom fields/i)).toBeInTheDocument()
    })
  })

  it('ShareModal', async () => {
    const { ShareModal } = await import('@/components/tasks/ShareModal')
    renderWithProviders(
      <ShareModal open taskId="task-1" taskTitle="Fix bug" onClose={vi.fn()} />,
    )
    expect(await screen.findByRole('heading', { name: 'Share this task' })).toBeInTheDocument()
  })

  it('MentionInput', async () => {
    const { MentionInput } = await import('@/components/comments/MentionInput')
    renderWithProviders(
      <MentionInput
        projectId="proj-1"
        value=""
        onChange={vi.fn()}
        onSubmit={vi.fn()}
        placeholder="Write a comment"
      />,
    )
    expect(screen.getByPlaceholderText('Write a comment')).toBeInTheDocument()
  })

  it('FormSharePanel', async () => {
    const { FormSharePanel } = await import('@/components/forms/FormSharePanel')
    renderWithProviders(
      <FormSharePanel
        open
        onClose={vi.fn()}
        publicToken="pub-token"
        formName="Feedback"
        isActive
      />,
    )
    expect(screen.getByText(/Share — Feedback/)).toBeInTheDocument()
  })

  it('FormFieldsRenderer', async () => {
    const { FormFieldsRenderer } = await import('@/components/forms/FormFieldsRenderer')
    renderWithProviders(
      <FormFieldsRenderer
        fields={mockFormDef().fields}
        values={{}}
        onChange={vi.fn()}
      />,
    )
    expect(screen.getByText('Name')).toBeInTheDocument()
  })

  it('GithubFeed', async () => {
    const { GithubFeed } = await import('@/components/github/GithubFeed')
    vi.mocked(api.get).mockImplementation(async (url: string) => {
      if (url.includes('/github/projects/') && url.includes('/connection')) {
        return { connected: false, github_user_login: null, can_connect: false }
      }
      if (url.includes('/github/projects/') && url.includes('/repositories')) return []
      if (url.includes('/github/projects/') && url.includes('/events')) return emptyPage
      if (url.includes('/github/')) return emptyPage
      if (url.includes('/comments')) return { ...emptyPage, page_size: 200 }
      return {}
    })
    renderWithProviders(<GithubFeed projectId="proj-1" />)
    expect(await screen.findByText(/GitHub not connected/i)).toBeInTheDocument()
    expect(screen.queryByText(/No GitHub activity/i)).not.toBeInTheDocument()
  })

  it('ProjectActivity', async () => {
    const { ProjectActivity } = await import('@/components/projects/ProjectActivity')
    renderWithProviders(<ProjectActivity projectId="proj-1" />)
    expect(await screen.findByText(/created task/i)).toBeInTheDocument()
    expect(screen.getByText('Test User')).toBeInTheDocument()
  })

  it('ProjectMembersModal', async () => {
    const { ProjectMembersModal } = await import('@/components/projects/ProjectMembersModal')
    renderWithProviders(
      <ProjectMembersModal
        open
        projectId="proj-1"
        workspaceId="ws-1"
        onClose={vi.fn()}
        onInviteByEmail={vi.fn()}
      />,
    )
    expect(await screen.findByRole('heading', { name: 'Project members' })).toBeInTheDocument()
  })

  it('InviteModal', async () => {
    const { InviteModal } = await import('@/components/invites/InviteModal')
    renderWithProviders(
      <InviteModal open defaultScope="workspace" defaultWorkspaceId="ws-1" onClose={vi.fn()} />,
    )
    expect(screen.getByRole('heading', { name: 'Invite people' })).toBeInTheDocument()
  })

  it('QuickCreateModal', async () => {
    const { QuickCreateModal } = await import('@/components/planner/QuickCreateModal')
    renderWithProviders(
      <QuickCreateModal
        slot={{ day: new Date('2024-06-01'), hour: 9 }}
        onClose={vi.fn()}
        onCreated={vi.fn()}
      />,
    )
    expect(screen.getByRole('button', { name: 'Event' })).toBeInTheDocument()
  })

  it('ProfileDrawer', async () => {
    const { ProfileDrawer } = await import('@/components/profile/ProfileDrawer')
    renderWithProviders(<ProfileDrawer open onClose={vi.fn()} />)
    expect(await screen.findByText('Test User')).toBeInTheDocument()
  })

  it('SearchCommand', async () => {
    const { SearchCommand } = await import('@/components/search/SearchCommand')
    renderWithProviders(<SearchCommand open onClose={vi.fn()} />)
    expect(await screen.findByPlaceholderText(/search/i)).toBeInTheDocument()
  })

  it('CreateChannelModal', async () => {
    const { CreateChannelModal } = await import('@/components/chat/CreateChannelModal')
    renderWithProviders(
      <CreateChannelModal open workspaceId="ws-1" onClose={vi.fn()} onCreated={vi.fn()} />,
    )
    expect(screen.getByRole('heading', { name: 'Create channel' })).toBeInTheDocument()
  })

  it('NotificationsDropdown', async () => {
    const { NotificationsDropdown } = await import('@/components/notifications/NotificationsDropdown')
    renderWithProviders(<NotificationsDropdown onClose={vi.fn()} />)
    expect(await screen.findByText('Notifications')).toBeInTheDocument()
  })

  it('StatusPicker', async () => {
    const { StatusPicker } = await import('@/components/tasks/pickers')
    const user = userEvent.setup()
    renderWithProviders(
      <StatusPicker projectId="proj-1" value={mockStatus} onChange={vi.fn()} />,
    )
    expect(screen.getByText('Open')).toBeInTheDocument()
    await user.click(screen.getByText('Open'))
    expect(screen.getByRole('button', { name: 'Open' })).toBeInTheDocument()
  })

  it('PriorityPicker', async () => {
    const { PriorityPicker } = await import('@/components/tasks/pickers')
    const user = userEvent.setup()
    renderWithProviders(
      <PriorityPicker value="high" onChange={vi.fn()}>
        <button type="button">Priority</button>
      </PriorityPicker>,
    )
    await user.click(screen.getByRole('button', { name: 'Priority' }))
    expect(screen.getByText('Urgent')).toBeInTheDocument()
  })

  it('DatePicker', async () => {
    const { DatePicker } = await import('@/components/tasks/pickers')
    const user = userEvent.setup()
    renderWithProviders(
      <DatePicker value="2024-06-01" onChange={vi.fn()}>
        <button type="button">Due date</button>
      </DatePicker>,
    )
    await user.click(screen.getByRole('button', { name: 'Due date' }))
    expect(screen.getByText('Clear date')).toBeInTheDocument()
  })

  it('AssigneePicker', async () => {
    const { AssigneePicker } = await import('@/components/tasks/pickers')
    const user = userEvent.setup()
    vi.mocked(api.get).mockImplementation(async (url: string) => {
      if (url.includes('/members')) {
        return [{ user_id: 'user-2', user: { id: 'user-2', full_name: 'Jane Doe', email: 'jane@example.com', avatar_url: null } }]
      }
      return {}
    })
    renderWithProviders(
      <AssigneePicker task={mockTask()}>
        <button type="button">Assignees</button>
      </AssigneePicker>,
    )
    await user.click(screen.getByRole('button', { name: 'Assignees' }))
    expect(await screen.findByText('Jane Doe')).toBeInTheDocument()
  })

  it('UI primitives', async () => {
    const [{ Avatar, AvatarStack }, { Dropdown }, { Modal }, badges] = await Promise.all([
      import('@/components/ui/Avatar'),
      import('@/components/ui/Dropdown'),
      import('@/components/ui/Modal'),
      import('@/components/ui/badges'),
    ])
    const { LabelChip, PriorityFlag, StatusIcon, StatusPill, TaskTypeBadge } = badges
    const user = userEvent.setup()
    renderWithProviders(
      <>
        <Avatar name="Test User" userId="user-1" />
        <AvatarStack users={[{ id: 'user-1', full_name: 'Test User', avatar_url: null }]} />
        <StatusIcon category={mockStatus.category} color={mockStatus.color} />
        <StatusPill status={mockStatus} />
        <PriorityFlag priority="high" withLabel />
        <TaskTypeBadge type="bug" withLabel />
        <LabelChip label="backend" />
        <Dropdown trigger={<button type="button">Menu</button>}>
          <button type="button">Item</button>
        </Dropdown>
        <Modal open onClose={vi.fn()} title="Test modal">
          <p>Modal body</p>
        </Modal>
      </>,
    )
    expect(screen.getByText('backend')).toBeInTheDocument()
    expect(screen.getByText('Test modal')).toBeInTheDocument()
    expect(screen.getByText('Modal body')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Menu' }))
    expect(screen.getByRole('button', { name: 'Item' })).toBeInTheDocument()
  })
})
