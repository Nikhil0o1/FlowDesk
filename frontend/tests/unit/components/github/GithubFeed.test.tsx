import { screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { GithubFeed } from '@/components/github/GithubFeed'
import { api } from '@/lib/api'
import { mockProject, mockUser } from '@tests/fixtures'
import { emptyPage } from '@tests/mockData'
import { renderWithProviders } from '@tests/renderWithProviders'
import { useAuthStore } from '@/stores/auth'

function githubFeedMock(conn: Record<string, unknown>, repos: unknown[] = [], available: unknown[] = []) {
  vi.mocked(api.get).mockImplementation(async (url: string) => {
    if (url.includes('/github/projects/') && url.includes('/connection')) return conn
    if (url.includes('/github/projects/') && url.includes('/repositories')) return repos
    if (url.includes('/available-repos')) return available
    if (url.includes('/events')) return emptyPage
    return {}
  })
}

describe('GithubFeed project admin controls', () => {
  beforeEach(() => {
    useAuthStore.setState({
      user: mockUser,
      loginContext: null,
      initialized: true,
      accessToken: 'test-token',
    })
  })

  it('shows Connect GitHub for project admin when disconnected', async () => {
    githubFeedMock({
      connected: false,
      github_user_login: null,
      can_connect: true,
    })

    renderWithProviders(<GithubFeed projectId={mockProject.id} />)

    expect(await screen.findByRole('button', { name: 'Connect GitHub' })).toBeInTheDocument()
    expect(screen.getByText(/GitHub not connected for this project/i)).toBeInTheDocument()
  })

  it('shows Link controls for admin when connected without a repo', async () => {
    githubFeedMock(
      {
        connected: true,
        github_user_login: 'admin-bot',
        can_connect: false,
        can_link_repo: true,
      },
      [],
      [{ repo_id: 1, repo_full_name: 'org/repo-a', default_branch: 'main', private: false }],
    )

    renderWithProviders(<GithubFeed projectId={mockProject.id} />)

    expect(await screen.findByText('admin-bot')).toBeInTheDocument()
    expect(screen.getByText(/Connected as/i)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Link' })).toBeInTheDocument()
    expect(await screen.findByRole('option', { name: 'org/repo-a' })).toBeInTheDocument()
  })

  it('hides Connect and Link for project members', async () => {
    githubFeedMock({
      connected: true,
      github_user_login: 'owner-bot',
      can_connect: false,
      can_link_repo: false,
    })

    renderWithProviders(<GithubFeed projectId={mockProject.id} />)

    expect(await screen.findByText('owner-bot')).toBeInTheDocument()
    expect(screen.getByText(/Connected as/i)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Connect GitHub' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Link' })).not.toBeInTheDocument()
    expect(screen.getByText(/No repository linked for this project/i)).toBeInTheDocument()
  })
})
