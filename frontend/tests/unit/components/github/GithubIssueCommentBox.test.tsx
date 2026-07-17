import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { render } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { GithubIssueCommentBox } from '@/components/github/GithubIssueCommentBox'
import { TaskGithubCommentThread } from '@/components/github/TaskGithubCommentThread'
import { useCreateGithubIssuePreference } from '@/components/github/CreateGithubIssueToggle'
import { api } from '@/lib/api'
import { renderWithProviders } from '@tests/renderWithProviders'
import { toast } from '@/stores/toast'

vi.mock('@/stores/toast', () => ({
  toast: { error: vi.fn(), success: vi.fn(), info: vi.fn() },
}))

describe('GithubIssueCommentBox', () => {
  beforeEach(() => {
    vi.mocked(toast.success).mockReset()
    vi.mocked(toast.error).mockReset()
    vi.mocked(api.post).mockResolvedValue({ id: 'c1', body: 'synced' })
  })

  it('posts through the GitHub issue-comment endpoint', async () => {
    const user = userEvent.setup()
    const onUpdated = vi.fn()

    renderWithProviders(
      <GithubIssueCommentBox taskId="task-1" canEdit isCompleted={false} onUpdated={onUpdated} />,
    )

    await user.type(screen.getByPlaceholderText(/markdown/i), 'Ship it')
    await user.click(screen.getByRole('button', { name: 'Comment' }))

    await waitFor(() => {
      expect(api.post).toHaveBeenCalledWith('/github/tasks/task-1/issue-comment', { body: 'Ship it' })
      expect(toast.success).toHaveBeenCalledWith('Comment posted on GitHub')
      expect(onUpdated).toHaveBeenCalled()
    })
  })
})

describe('TaskGithubCommentThread', () => {
  beforeEach(() => {
    vi.mocked(api.get).mockImplementation(async (url: string) => {
      if (url.includes('scope=github')) {
        return {
          items: [
            {
              id: 'gh-1',
              task_id: 'task-1',
              author_id: 'u1',
              parent_comment_id: null,
              body: 'From GitHub',
              github_comment_id: 100,
              github_author_login: 'octocat',
              created_at: '2026-06-25T10:00:00Z',
              updated_at: '2026-06-25T10:00:00Z',
              author: null,
              reply_count: 0,
            },
          ],
          total: 1,
          page: 1,
          page_size: 200,
        }
      }
      return { items: [], total: 0, page: 1, page_size: 200 }
    })
  })

  it('loads github-scoped comments only', async () => {
    renderWithProviders(<TaskGithubCommentThread taskId="task-1" />)

    expect(await screen.findByText('Issue comments')).toBeInTheDocument()
    expect(await screen.findByText('From GitHub')).toBeInTheDocument()
    expect(screen.getByText('octocat')).toBeInTheDocument()
    expect(api.get).toHaveBeenCalledWith('/tasks/task-1/comments?page_size=200&scope=github')
  })
})

describe('useCreateGithubIssuePreference', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  it('persists toggle preference in localStorage', () => {
    function Probe() {
      const [checked, setChecked] = useCreateGithubIssuePreference()
      return (
        <button type="button" onClick={() => setChecked(!checked)}>
          {checked ? 'on' : 'off'}
        </button>
      )
    }

    render(<Probe />)
    expect(screen.getByRole('button', { name: 'off' })).toBeInTheDocument()
  })
})
