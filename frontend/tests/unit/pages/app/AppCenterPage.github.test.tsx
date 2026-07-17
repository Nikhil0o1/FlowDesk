import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import AppCenterPage from '@/pages/app/AppCenterPage'
import { api } from '@/lib/api'
import { useCurrentContext, useProjects } from '@/lib/queries'
import { mockCurrentContext, mockProject, mockUser, mockWorkspace } from '@tests/fixtures'
import { renderWithProviders } from '@tests/renderWithProviders'
import { useAuthStore } from '@/stores/auth'

function githubApiMock(conn: Record<string, unknown>, repos: unknown[] = []) {
  vi.mocked(api.get).mockImplementation(async (url: string) => {
    if (url.includes('/integrations/google/status')) {
      return { configured: false, connected: false, account_email: null, scopes: {} }
    }
    if (url.includes('/github/organizations/') && url.includes('personal-connection') && !url.includes('repos') && !url.includes('links')) {
      return { connected: false, github_user_login: null }
    }
    if (url.includes('/github/projects/') && url.includes('/connection')) {
      return conn
    }
    if (url.includes('/github/projects/') && url.includes('/repositories')) {
      return repos
    }
    if (url.includes('/available-repos')) return []
    if (url.includes('/personal-connection/repos')) return []
    if (url.includes('/personal-connection/links')) return []
    return {}
  })
}

describe('AppCenterPage GitHub project permissions', () => {
  beforeEach(() => {
    useAuthStore.setState({
      user: mockUser,
      loginContext: null,
      initialized: true,
      accessToken: 'test-token',
    })
    vi.mocked(useProjects).mockReturnValue({
      data: [mockProject],
      isLoading: false,
    } as ReturnType<typeof useProjects>)
  })

  it('shows Connect for project admin when disconnected', async () => {
    githubApiMock({
      connected: false,
      github_user_login: null,
      can_manage: true,
      can_connect: true,
      can_disconnect: false,
      can_link_repo: false,
    })

    renderWithProviders(<AppCenterPage />, {
      routerProps: { initialEntries: ['/app/apps?app=github'] },
    })

    await userEvent.click(await screen.findByRole('button', { name: 'Project' }))
    expect(await screen.findByText(/GitHub not connected for/i)).toBeInTheDocument()
    expect(screen.getAllByRole('button', { name: 'Connect' }).length).toBeGreaterThanOrEqual(1)
  })

  it('hides project Connect and Disconnect for non-admin member', async () => {
    githubApiMock(
      {
        connected: true,
        github_user_login: 'owner-bot',
        can_manage: false,
        can_connect: false,
        can_disconnect: false,
        can_link_repo: false,
        branch_name_format: ':taskId:-:taskName:',
        connected_search_enabled: true,
      },
      [
        {
          id: 'repo-1',
          repo_full_name: 'Nikhil0o1/Web-3--Real-Estate',
          is_active: true,
          connected_by: 'other-user-id',
          repo_id: 1,
          project_id: mockProject.id,
          workspace_id: mockWorkspace.id,
          connection_id: 'conn-1',
          installation_id: null,
          created_at: '2024-01-01T00:00:00Z',
        },
      ],
    )

    renderWithProviders(<AppCenterPage />, {
      routerProps: { initialEntries: ['/app/apps?app=github'] },
    })

    await userEvent.click(await screen.findByRole('button', { name: 'Project' }))
    expect(screen.queryByText(/GitHub not connected/i)).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Disconnect' })).not.toBeInTheDocument()
    expect(await screen.findByText(/Connected as/i)).toBeInTheDocument()
    expect(screen.getByText('Nikhil0o1/Web-3--Real-Estate')).toBeInTheDocument()
    expect(screen.queryByText('Tokens:')).not.toBeInTheDocument()
    expect(screen.queryByText(':taskId:-:taskName:')).not.toBeInTheDocument()
    expect(screen.queryByText(/Settings/i)).not.toBeInTheDocument()
    expect(screen.queryByPlaceholderText(/Search code across this project's repos/i)).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Save settings' })).not.toBeInTheDocument()
    expect(screen.queryByTitle('Unlink repository')).not.toBeInTheDocument()
  })

  it('shows Disconnect only for the connector admin', async () => {
    githubApiMock(
      {
        connected: true,
        github_user_login: 'owner-bot',
        can_manage: true,
        can_connect: false,
        can_disconnect: true,
        can_link_repo: false,
        connected_by: mockUser.id,
      },
      [
        {
          id: 'repo-1',
          repo_full_name: 'acme/app',
          is_active: true,
          connected_by: mockUser.id,
          repo_id: 1,
          project_id: mockProject.id,
          workspace_id: mockWorkspace.id,
          connection_id: null,
          installation_id: null,
          created_at: '2024-01-01T00:00:00Z',
        },
      ],
    )

    renderWithProviders(<AppCenterPage />, {
      routerProps: { initialEntries: ['/app/apps?app=github'] },
    })

    await userEvent.click(await screen.findByRole('button', { name: 'Project' }))
    expect(await screen.findByRole('button', { name: 'Disconnect' })).toBeInTheDocument()
    expect(screen.getByTitle('Unlink repository')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Link' })).not.toBeInTheDocument()
    expect(screen.queryByText(/Settings/i)).not.toBeInTheDocument()
    expect(screen.queryByPlaceholderText(/Search code across this project's repos/i)).not.toBeInTheDocument()
  })

  it('hides Disconnect and unlink for other project admin', async () => {
    githubApiMock(
      {
        connected: true,
        github_user_login: 'owner-bot',
        can_manage: true,
        can_connect: false,
        can_disconnect: false,
        can_link_repo: false,
        connected_by: 'other-user-id',
      },
      [
        {
          id: 'repo-1',
          repo_full_name: 'acme/app',
          is_active: true,
          connected_by: 'other-user-id',
          repo_id: 1,
          project_id: mockProject.id,
          workspace_id: mockWorkspace.id,
          connection_id: null,
          installation_id: null,
          created_at: '2024-01-01T00:00:00Z',
        },
      ],
    )

    renderWithProviders(<AppCenterPage />, {
      routerProps: { initialEntries: ['/app/apps?app=github'] },
    })

    await userEvent.click(await screen.findByRole('button', { name: 'Project' }))
    await waitFor(() => {
      expect(screen.queryByRole('button', { name: 'Disconnect' })).not.toBeInTheDocument()
    })
    expect(screen.queryByTitle('Unlink repository')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Link' })).not.toBeInTheDocument()
    expect(screen.getByText('acme/app')).toBeInTheDocument()
  })

  it('shows Link controls only when connector can link', async () => {
    vi.mocked(api.get).mockImplementation(async (url: string) => {
      if (url.includes('/integrations/google/status')) {
        return { configured: false, connected: false, account_email: null, scopes: {} }
      }
      if (url.includes('/github/organizations/') && url.includes('personal-connection') && !url.includes('repos') && !url.includes('links')) {
        return { connected: false, github_user_login: null }
      }
      if (url.includes('/github/projects/') && url.includes('/connection')) {
        return {
          connected: true,
          github_user_login: 'owner-bot',
          can_manage: true,
          can_connect: false,
          can_disconnect: true,
          can_link_repo: true,
          connected_by: mockUser.id,
        }
      }
      if (url.includes('/github/projects/') && url.includes('/repositories')) return []
      if (url.includes('/available-repos')) {
        return [{ repo_id: 1, repo_full_name: 'acme/app', default_branch: 'main', private: false }]
      }
      if (url.includes('/personal-connection/repos')) return []
      if (url.includes('/personal-connection/links')) return []
      return {}
    })

    renderWithProviders(<AppCenterPage />, {
      routerProps: { initialEntries: ['/app/apps?app=github'] },
    })

    await userEvent.click(await screen.findByRole('button', { name: 'Project' }))
    expect(await screen.findByRole('button', { name: 'Link' })).toBeInTheDocument()
    expect(screen.getByText('Select a repository')).toBeInTheDocument()
  })

  it('shows project-linked repo on Personal tab', async () => {
    vi.mocked(api.get).mockImplementation(async (url: string) => {
      if (url.includes('/integrations/google/status')) {
        return { configured: false, connected: false, account_email: null, scopes: {} }
      }
      if (url.includes('/github/organizations/') && url.includes('personal-connection') && !url.includes('repos') && !url.includes('links')) {
        return { connected: true, github_user_login: 'dev-user' }
      }
      if (url.includes('/personal-connection/repos')) {
        return [{ repo_id: 1, repo_full_name: 'yanthraa-information-systems/flowdesk_API', default_branch: 'main', private: true }]
      }
      if (url.includes('/personal-connection/links')) return []
      if (url.includes('/github/projects/') && url.includes('/repositories')) {
        return [{
          id: 'repo-1',
          repo_full_name: 'yanthraa-information-systems/flowdesk_API',
          is_active: true,
          connected_by: mockUser.id,
          repo_id: 1,
          project_id: mockProject.id,
          workspace_id: mockWorkspace.id,
          connection_id: 'conn-1',
          installation_id: null,
          created_at: '2024-01-01T00:00:00Z',
        }]
      }
      if (url.includes('/github/projects/') && url.includes('/connection')) {
        return { connected: false, github_user_login: null }
      }
      if (url.includes('/available-repos')) return []
      return {}
    })

    renderWithProviders(<AppCenterPage />, {
      routerProps: { initialEntries: ['/app/apps?app=github'] },
    })

    expect(await screen.findByText(/yanthraa-information-systems\/flowdesk_API/i)).toBeInTheDocument()
    expect(await screen.findByText(`→ ${mockProject.name}`)).toBeInTheDocument()
    expect(screen.getByTitle('Unlink')).toBeInTheDocument()
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument()
  })

  it('hides personal Link to for project members', async () => {
    vi.mocked(useCurrentContext).mockReturnValue(
      mockCurrentContext({
        org: { ...mockCurrentContext().org!, my_role: 'member' },
        workspace: { ...mockCurrentContext().workspace!, my_role: 'member' },
      }),
    )
    vi.mocked(useProjects).mockReturnValue({
      data: [{ ...mockProject, my_role: 'member' }],
      isLoading: false,
    } as ReturnType<typeof useProjects>)

    vi.mocked(api.get).mockImplementation(async (url: string) => {
      if (url.includes('/integrations/google/status')) {
        return { configured: false, connected: false, account_email: null, scopes: {} }
      }
      if (url.includes('/github/organizations/') && url.includes('personal-connection') && !url.includes('repos') && !url.includes('links')) {
        return { connected: true, github_user_login: 'dev-user' }
      }
      if (url.includes('/personal-connection/repos')) {
        return [{ repo_id: 9, repo_full_name: 'acme/unlinked', default_branch: 'main', private: false }]
      }
      if (url.includes('/personal-connection/links')) return []
      if (url.includes('/github/projects/') && url.includes('/repositories')) return []
      if (url.includes('/github/projects/') && url.includes('/connection')) {
        return { connected: false, github_user_login: null, can_manage: false }
      }
      return {}
    })

    renderWithProviders(<AppCenterPage />, {
      routerProps: { initialEntries: ['/app/apps?app=github'] },
    })

    expect(await screen.findByText('acme/unlinked')).toBeInTheDocument()
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument()
    expect(screen.queryByText('Link to…')).not.toBeInTheDocument()
  })

  it('hides personal Link to when project has shared GitHub connection without a repo', async () => {
    vi.mocked(api.get).mockImplementation(async (url: string) => {
      if (url.includes('/integrations/google/status')) {
        return { configured: false, connected: false, account_email: null, scopes: {} }
      }
      if (url.includes('/github/organizations/') && url.includes('personal-connection') && !url.includes('repos') && !url.includes('links')) {
        return { connected: true, github_user_login: 'dev-user' }
      }
      if (url.includes('/personal-connection/repos')) {
        return [{ repo_id: 9, repo_full_name: 'acme/relink', default_branch: 'main', private: false }]
      }
      if (url.includes('/personal-connection/links')) return []
      if (url.includes('/github/projects/') && url.includes('/repositories')) return []
      if (url.includes('/github/projects/') && url.includes('/connection')) {
        return {
          connected: true,
          github_user_login: 'proj-bot',
          can_manage: true,
          can_connect: false,
          can_disconnect: true,
          can_link_repo: true,
          connected_by: mockUser.id,
        }
      }
      if (url.includes('/available-repos')) return []
      return {}
    })

    renderWithProviders(<AppCenterPage />, {
      routerProps: { initialEntries: ['/app/apps?app=github'] },
    })

    expect(await screen.findByText('acme/relink')).toBeInTheDocument()
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument()
    expect(screen.queryByText('Link to…')).not.toBeInTheDocument()
  })

  it('shows linked repository section when project is disconnected for members', async () => {
    vi.mocked(useProjects).mockReturnValue({
      data: [{ ...mockProject, name: 'windsurf', my_role: 'member' }],
      isLoading: false,
    } as ReturnType<typeof useProjects>)

    githubApiMock({
      connected: false,
      github_user_login: null,
      can_manage: false,
      can_connect: false,
      can_disconnect: false,
      can_link_repo: false,
    })

    renderWithProviders(<AppCenterPage />, {
      routerProps: { initialEntries: ['/app/apps?app=github'] },
    })

    await userEvent.click(await screen.findByRole('button', { name: 'Project' }))
    expect(await screen.findByText(/Linked repository/i)).toBeInTheDocument()
    expect(screen.getByText(/GitHub is not connected for this project yet/i)).toBeInTheDocument()
  })
})
