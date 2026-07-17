import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { Route, Routes } from 'react-router-dom'

import TaskPage from '@/pages/app/TaskPage'
import { api } from '@/lib/api'
import { mockProject, mockUser } from '@tests/fixtures'
import { emptyPage, mockStatus, mockTaskDetail } from '@tests/mockData'
import { renderWithProviders } from '@tests/renderWithProviders'
import { useAuthStore } from '@/stores/auth'
import { toast } from '@/stores/toast'
import { useProject, useSprints, useStatuses } from '@/lib/queries'

vi.mock('@/stores/toast', () => ({
  toast: { error: vi.fn(), success: vi.fn(), info: vi.fn() },
}))

vi.mock('@/lib/taskMutations', () => ({
  useTaskPatch: vi.fn(() => ({ mutate: vi.fn(), isPending: false })),
  withDueDate: vi.fn(),
  withPriority: vi.fn(),
  withStatus: vi.fn(),
}))

const linkedRepo = {
  id: 'repo-uuid-1',
  repo_full_name: 'owner/example-repo',
  default_branch: 'main',
  is_active: true,
}

function setupGithubApi(repos: unknown[] = [linkedRepo], events: unknown[] = []) {
  vi.mocked(api.get).mockImplementation(async (url: string) => {
    if (url.includes('/github/projects') && url.includes('/repositories')) return repos
    if (url.includes('/github/tasks/task-1/sync-issue-status')) return { updated: false }
    if (url.includes('/github/tasks/task-1/sync-sub-issues')) return { imported: 0 }
    if (url.includes('/github/tasks/task-1/sync-issue-comments')) return { imported: 0 }
    if (url.includes('/github/tasks/task-1/branch-name')) return { branch_name: 'alpha-1-fix-bug' }
    if (url.includes('/github/tasks/task-1/events')) return events
    if (url.includes('/tasks/task-1/sprints')) return []
    if (url.includes('/tasks/task-1') && !url.includes('/sprints') && !url.includes('/comments') && !url.includes('/time-entries') && !url.includes('/emails') && !url.includes('/share')) {
      return {
        ...mockTaskDetail(),
        github_issue_number: 1,
        github_issue_url: 'https://github.com/owner/example-repo/issues/1',
      }
    }
    if (url.includes('/tasks/task-1')) return mockTaskDetail()
    if (url.includes('/sprints')) return []
    if (url.includes('/comments') && url.includes('scope=github')) {
      return { ...emptyPage, page_size: 200 }
    }
    if (url.includes('/comments') && url.includes('scope=local')) {
      return { ...emptyPage, page_size: 200 }
    }
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
}

describe('TaskPage Development panel', () => {
  beforeEach(() => {
    vi.mocked(toast.success).mockReset()
    vi.mocked(toast.error).mockReset()
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
    vi.mocked(api.post).mockResolvedValue({})
  })

  it('shows linked repo as static text without a dropdown', async () => {
    setupGithubApi()

    renderWithProviders(
      <Routes>
        <Route path="/app/tasks/:taskId" element={<TaskPage />} />
      </Routes>,
      { routerProps: { initialEntries: ['/app/tasks/task-1'] } },
    )

    await screen.findByRole('heading', { name: 'Fix bug' })
    expect(await screen.findByText('owner/example-repo')).toBeInTheDocument()
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument()
    expect(screen.queryByText(/no repositories available/i)).not.toBeInTheDocument()
  })

  it('creates branch against the linked repo', async () => {
    setupGithubApi()
    const user = userEvent.setup()
    vi.spyOn(window, 'open').mockImplementation(() => null)
    vi.mocked(api.post).mockImplementation(async (url: string, body?: unknown) => {
      if (url.includes('/create-branch')) return { branch: 'alpha-1-fix-bug', url: 'https://github.com/owner/example-repo/tree/alpha-1-fix-bug' }
      if (url.includes('/sync-issue-status')) return { updated: false }
      if (url.includes('/sync-sub-issues')) return { imported: 0 }
      if (url.includes('/sync-issue-comments')) return { imported: 0 }
      return body ?? {}
    })

    renderWithProviders(
      <Routes>
        <Route path="/app/tasks/:taskId" element={<TaskPage />} />
      </Routes>,
      { routerProps: { initialEntries: ['/app/tasks/task-1'] } },
    )

    await screen.findByRole('heading', { name: 'Fix bug' })
    expect(screen.queryByRole('button', { name: 'Create pull request' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Create GitHub Issue' })).not.toBeInTheDocument()

    await user.click(await screen.findByRole('button', { name: 'Create branch' }))

    await waitFor(() => {
      expect(api.post).toHaveBeenCalledWith('/github/tasks/task-1/create-branch', {
        repository_id: 'repo-uuid-1',
        branch_name: 'alpha-1-fix-bug',
      })
      expect(toast.success).toHaveBeenCalledWith('Branch ready: alpha-1-fix-bug')
    })
    expect(window.open).toHaveBeenCalledWith(
      'https://github.com/owner/example-repo/tree/alpha-1-fix-bug',
      '_blank',
      'noopener,noreferrer',
    )
  })

  it('shows reopen issue when task is completed and has a linked issue', async () => {
    setupGithubApi()
    vi.mocked(api.get).mockImplementation(async (url: string) => {
      if (url.includes('/tasks/task-1') && !url.includes('/sprints') && !url.includes('/events')) {
        return {
          ...mockTaskDetail(),
          github_issue_number: 1,
          github_issue_url: 'https://github.com/owner/example-repo/issues/1',
          status: { ...mockStatus, category: 'done', name: 'Complete' },
        }
      }
      if (url.includes('/github/projects') && url.includes('/repositories')) return [linkedRepo]
      if (url.includes('/sync-issue-status')) return { updated: false }
      if (url.includes('/github/tasks/task-1/branch-name')) return { branch_name: 'alpha-1-fix-bug' }
      if (url.includes('/github/tasks/task-1/events')) return []
      if (url.includes('/tasks/task-1/sprints')) return []
      if (url.includes('/sprints')) return []
      if (url.includes('/comments') && url.includes('scope=github')) {
      return { ...emptyPage, page_size: 200 }
    }
    if (url.includes('/comments') && url.includes('scope=local')) {
      return { ...emptyPage, page_size: 200 }
    }
    if (url.includes('/comments')) return { ...emptyPage, page_size: 200 }
      if (url.includes('/custom-fields')) return []
      if (url.includes('/time-entries')) return emptyPage
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
    expect(await screen.findByRole('button', { name: 'Reopen issue' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Create pull request' })).not.toBeInTheDocument()
  })

  it('reopens issue and refreshes task caches', async () => {
    setupGithubApi()
    const user = userEvent.setup()
    vi.mocked(api.get).mockImplementation(async (url: string) => {
      if (url.includes('/tasks/task-1') && !url.includes('/sprints') && !url.includes('/events')) {
        return {
          ...mockTaskDetail(),
          github_issue_number: 1,
          github_issue_url: 'https://github.com/owner/example-repo/issues/1',
          status: { ...mockStatus, category: 'done', name: 'Complete' },
        }
      }
      if (url.includes('/github/projects') && url.includes('/repositories')) return [linkedRepo]
      if (url.includes('/sync-issue-status')) return { updated: false }
      if (url.includes('/github/tasks/task-1/branch-name')) return { branch_name: 'alpha-1-fix-bug' }
      if (url.includes('/github/tasks/task-1/events')) return []
      if (url.includes('/tasks/task-1/sprints')) return []
      if (url.includes('/sprints')) return []
      if (url.includes('/comments') && url.includes('scope=github')) {
      return { ...emptyPage, page_size: 200 }
    }
    if (url.includes('/comments') && url.includes('scope=local')) {
      return { ...emptyPage, page_size: 200 }
    }
    if (url.includes('/comments')) return { ...emptyPage, page_size: 200 }
      if (url.includes('/custom-fields')) return []
      if (url.includes('/time-entries')) return emptyPage
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
    vi.mocked(api.post).mockImplementation(async (url: string) => {
      if (url.includes('/reopen-issue')) return { updated: true, status_id: 'status-todo' }
      if (url.includes('/sync-issue-status')) return { updated: false }
      if (url.includes('/sync-sub-issues')) return { imported: 0 }
      if (url.includes('/sync-issue-comments')) return { imported: 0 }
      return {}
    })

    renderWithProviders(
      <Routes>
        <Route path="/app/tasks/:taskId" element={<TaskPage />} />
      </Routes>,
      { routerProps: { initialEntries: ['/app/tasks/task-1'] } },
    )

    await screen.findByRole('heading', { name: 'Fix bug' })
    await user.click(await screen.findByRole('button', { name: 'Reopen issue' }))

    await waitFor(() => {
      expect(api.post).toHaveBeenCalledWith('/github/tasks/task-1/reopen-issue')
      expect(toast.success).toHaveBeenCalledWith('Issue reopened — task moved to To Do')
    })
  })

  it('shows linked GitHub issue when task already has one', async () => {
    setupGithubApi()
    vi.mocked(api.get).mockImplementation(async (url: string) => {
      if (url.includes('/tasks/task-1') && !url.includes('/sprints') && !url.includes('/events')) {
        return {
          ...mockTaskDetail(),
          github_issue_number: 42,
          github_issue_url: 'https://github.com/owner/example-repo/issues/42',
        }
      }
      if (url.includes('/github/projects') && url.includes('/repositories')) return [linkedRepo]
      if (url.includes('/sync-issue-status')) return { updated: false }
      if (url.includes('/github/tasks/task-1/branch-name')) return { branch_name: 'alpha-1-fix-bug' }
      if (url.includes('/github/tasks/task-1/events')) return []
      if (url.includes('/tasks/task-1/sprints')) return []
      if (url.includes('/sprints')) return []
      if (url.includes('/comments') && url.includes('scope=github')) {
      return { ...emptyPage, page_size: 200 }
    }
    if (url.includes('/comments') && url.includes('scope=local')) {
      return { ...emptyPage, page_size: 200 }
    }
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

    renderWithProviders(
      <Routes>
        <Route path="/app/tasks/:taskId" element={<TaskPage />} />
      </Routes>,
      { routerProps: { initialEntries: ['/app/tasks/task-1'] } },
    )

    await screen.findByRole('heading', { name: 'Fix bug' })
    expect(await screen.findByRole('link', { name: 'Issue #42' })).toHaveAttribute(
      'href',
      'https://github.com/owner/example-repo/issues/42',
    )
    expect(screen.queryByRole('button', { name: 'Create GitHub Issue' })).not.toBeInTheDocument()
  })
})
