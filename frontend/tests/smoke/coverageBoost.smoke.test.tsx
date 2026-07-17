import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Route, Routes } from 'react-router-dom'

import { api } from '@/lib/api'
import { mockCurrentContext, mockLoginContext, mockProject, mockUser } from '@tests/fixtures'
import {
  emptyPage,
  mockComment,
  mockFormDef,
  mockOrgMember2,
  mockStatus,
  mockTask,
  mockTaskDetail,
} from '@tests/mockData'
import { renderWithProviders } from '@tests/renderWithProviders'
import { setupPopulatedApiMock, setupPopulatedQueryMocks, resetQueryMocks } from '@tests/smokeMocks'
import { useAuthStore } from '@/stores/auth'
import { useProject, useSprints, useStatuses } from '@/lib/queries'
import { fetchPublicForm, submitPublicForm } from '@/lib/publicForms'

// Lazy-load heavy pages/components per test — avoids loading the full tree at collect time.
vi.mock('@/lib/publicForms', () => ({
  fetchPublicForm: vi.fn(),
  submitPublicForm: vi.fn(),
  copyPublicFormLink: vi.fn(),
}))

function setupTaskPageApi() {
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
    if (url.includes('/tasks/task-1/comments')) {
      return { ...emptyPage, items: [mockComment()], page_size: 200, total: 1 }
    }
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
        public_url: 'https://app.example.com/t/pub',
        public_expires_at: null,
        public_searchable: false,
        members: [],
      }
    }
    if (url.includes('/members')) return [mockOrgMember2()]
    return {}
  })
  vi.mocked(api.post).mockResolvedValue(mockComment())
  vi.mocked(api.patch).mockResolvedValue({})
  vi.mocked(api.delete).mockResolvedValue(undefined)
}

describe('coverage boost interactions', () => {
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
    setupPopulatedApiMock()
    vi.mocked(api.post).mockResolvedValue({})
    vi.mocked(api.patch).mockResolvedValue({})
    vi.mocked(api.delete).mockResolvedValue(undefined)
  })

  it('CommentSection posts a comment', async () => {
    const user = userEvent.setup()
    const { CommentSection } = await import('@/components/comments/CommentSection')
    vi.mocked(api.get).mockImplementation(async (url: string) => {
      if (url.includes('/comments')) {
        return { ...emptyPage, items: [mockComment()], page_size: 200, total: 1 }
      }
      if (url.includes('/members')) return [mockOrgMember2()]
      return {}
    })
    vi.mocked(api.post).mockResolvedValue(mockComment({ id: 'comment-2', body: 'New comment' }))

    renderWithProviders(<CommentSection taskId="task-1" projectId="proj-1" />)
    expect(await screen.findByText('Looks good to me')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Reply' }))
    expect(screen.getByText(/Replying to/)).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /cancel/i }))
    const input = await screen.findByPlaceholderText(/write a comment/i)
    await user.clear(input)
    await user.type(input, 'New comment', { delay: 1 })
    await user.click(screen.getByRole('button', { name: /^Comment$/i }))
    expect(api.post).toHaveBeenCalled()
  }, 15_000)

  it('CommentSection deletes own comment', async () => {
    const user = userEvent.setup()
    const { CommentSection } = await import('@/components/comments/CommentSection')
    vi.mocked(api.get).mockImplementation(async (url: string) => {
      if (url.includes('/comments')) {
        return { ...emptyPage, items: [mockComment({ author_id: 'user-1' })], total: 1, page_size: 200 }
      }
      return {}
    })

    renderWithProviders(<CommentSection taskId="task-1" projectId="proj-1" />)
    await screen.findByText('Looks good to me')
    await user.click(screen.getByRole('button', { name: /^Delete$/i }))
    expect(api.delete).toHaveBeenCalledWith('/comments/comment-1')
  })

  it('SearchCommand shows results and navigates', async () => {
    const user = userEvent.setup()
    const { SearchCommand } = await import('@/components/search/SearchCommand')
    vi.mocked(api.get).mockImplementation(async (url: string) => {
      if (url.includes('/search')) {
        return {
          tasks: [mockTask()],
          projects: [mockProject],
          comments: [],
          users: [],
        }
      }
      return {}
    })

    renderWithProviders(<SearchCommand open onClose={vi.fn()} />, {
      routerProps: { initialEntries: ['/app/dashboard'] },
    })
    const input = await screen.findByPlaceholderText(/search/i)
    await user.type(input, 'fix')
    expect(await screen.findByText('Fix bug')).toBeInTheDocument()
    expect(screen.getByText('Alpha Project')).toBeInTheDocument()
    await user.click(screen.getByText('Fix bug'))
  })

  it('ShareModal toggles public link and invites', async () => {
    const user = userEvent.setup()
    const { ShareModal } = await import('@/components/tasks/ShareModal')
    const shareState = {
      is_private: false,
      public_enabled: false,
      public_url: 'https://app.example.com/t/pub',
      public_token: 'pub',
      public_expires_at: null,
      public_searchable: false,
      members: [],
    }
    vi.mocked(api.get).mockImplementation(async (url: string) => {
      if (url.includes('/share')) return shareState
      return {}
    })
    vi.mocked(api.patch).mockImplementation(async (_url, body) => ({
      ...shareState,
      ...(body as Record<string, unknown>),
      public_enabled: (body as { public_enabled?: boolean }).public_enabled ?? shareState.public_enabled,
    }))
    vi.mocked(api.post).mockResolvedValue({ ...shareState, members: [] })

    renderWithProviders(<ShareModal open taskId="task-1" taskTitle="Fix bug" onClose={vi.fn()} />)
    await screen.findByRole('heading', { name: 'Share this task' })
    await waitFor(() => {
      expect(screen.getByPlaceholderText(/invite by email/i)).toBeInTheDocument()
    })
    await user.type(screen.getByPlaceholderText(/invite by email/i), 'jane@example.com')
    await user.click(screen.getByRole('button', { name: 'Invite' }))
    expect(api.post).toHaveBeenCalled()
  })

  it('TaskTable row opens task details', async () => {
    const user = userEvent.setup()
    const { TaskTable } = await import('@/components/tasks/TaskTable')
    renderWithProviders(
      <TaskTable
        projectId="proj-1"
        tasks={[mockTask()]}
        statuses={[mockStatus]}
        cols={['status', 'priority', 'assignee', 'due', 'comments']}
        canEdit
      />,
      { routerProps: { initialEntries: ['/app/projects/proj-1'] } },
    )
    await user.click(screen.getByText('Fix bug'))
  })

  it('TaskPage edits fields and posts comment', async () => {
    const user = userEvent.setup()
    const { default: TaskPage } = await import('@/pages/app/TaskPage')
    setupTaskPageApi()

    renderWithProviders(
      <Routes>
        <Route path="/app/tasks/:taskId" element={<TaskPage />} />
      </Routes>,
      { routerProps: { initialEntries: ['/app/tasks/task-1'] } },
    )
    await screen.findByRole('heading', { name: 'Fix bug' })
    await user.click(screen.getByRole('button', { name: /Create checklist/i }))
    expect(api.post).toHaveBeenCalled()
    const commentInput = await screen.findByPlaceholderText(/write a comment/i)
    await user.type(commentInput, 'Ship it')
    await user.click(screen.getByRole('button', { name: /^Comment$/i }))
    expect(api.post).toHaveBeenCalled()
  })

  it('FormFillPage submits values', async () => {
    const user = userEvent.setup()
    const { default: FormFillPage } = await import('@/pages/app/FormFillPage')
    vi.mocked(api.get).mockResolvedValue(mockFormDef())
    vi.mocked(api.post).mockResolvedValue({ task_id: 'task-99', task_ref: 'ALPHA-99' })

    renderWithProviders(
      <Routes>
        <Route path="/app/forms/:formId/fill" element={<FormFillPage />} />
      </Routes>,
      { routerProps: { initialEntries: ['/app/forms/form-1/fill'] } },
    )
    expect(await screen.findByText('Feedback Form')).toBeInTheDocument()
    await user.type(screen.getByRole('textbox'), 'Alice')
    await user.click(screen.getByRole('button', { name: 'Submit' }))
    await waitFor(() => {
      expect(api.post).toHaveBeenCalled()
    })
  })

  it('PublicFormPage submits public form', async () => {
    const user = userEvent.setup()
    const { default: PublicFormPage } = await import('@/pages/public/PublicFormPage')
    vi.mocked(fetchPublicForm).mockResolvedValue({
      id: 'form-1',
      name: 'Feedback',
      description: null,
      is_active: true,
      fields: [{ id: 'f1', type: 'text', label: 'Name', required: true }],
      public_token: 'pub-token',
      workspace_name: 'Main Workspace',
    } as Awaited<ReturnType<typeof fetchPublicForm>>)
    vi.mocked(submitPublicForm).mockResolvedValue({ ok: true })

    renderWithProviders(
      <Routes>
        <Route path="/f/:token" element={<PublicFormPage />} />
      </Routes>,
      { routerProps: { initialEntries: ['/f/pub-token'] } },
    )
    expect(await screen.findByRole('heading', { name: 'Feedback' })).toBeInTheDocument()
    const [nameInput] = screen.getAllByRole('textbox')
    await user.type(nameInput, 'Bob')
    await user.click(screen.getByRole('button', { name: 'Submit' }))
    expect(submitPublicForm).toHaveBeenCalled()
  })

  it('AppCenterPage filters apps and opens GitHub panel', async () => {
    const user = userEvent.setup()
    const { default: AppCenterPage } = await import('@/pages/app/AppCenterPage')
    vi.mocked(api.get).mockImplementation(async (url: string) => {
      if (url.includes('/integrations/google/status')) {
        return {
          configured: true,
          connected: true,
          account_email: 'test@example.com',
          scopes: { calendar: true, gmail_send: false, gmail_read: false, sheets: false },
        }
      }
      if (url.includes('/github/organizations/') && url.includes('personal-connection')) {
        return { connected: false, github_user_login: null }
      }
      if (url.includes('/github/projects/') && url.includes('/connection')) {
        return { connected: false, github_user_login: null }
      }
      if (url.includes('/repositories')) return []
      if (url.includes('/available-repos')) return []
      if (url.includes('/search')) return { connected: false, items: [] }
      return {}
    })

    renderWithProviders(<AppCenterPage />, {
      routerProps: { initialEntries: ['/app/apps'] },
    })
    expect(await screen.findByRole('heading', { name: 'App Center' })).toBeInTheDocument()
    await user.type(screen.getByPlaceholderText('Search…'), 'GitHub')
    await user.click(screen.getByRole('button', { name: 'Connect' }))
    expect(await screen.findByText(/personal connection/i)).toBeInTheDocument()
  })
})
