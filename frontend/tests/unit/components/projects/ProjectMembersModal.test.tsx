import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { ProjectMembersModal } from '@/components/projects/ProjectMembersModal'
import { api } from '@/lib/api'
import { mockUser } from '@tests/fixtures'
import { renderWithProviders } from '@tests/renderWithProviders'
import { useAuthStore } from '@/stores/auth'
import { useTeams } from '@/lib/queries'

const members = [
  {
    id: 'pm-1',
    user_id: 'user-admin',
    role: 'admin',
    user: { id: 'user-admin', email: 'admin@test.dev', full_name: 'Admin User', avatar_url: null },
  },
  {
    id: 'pm-2',
    user_id: 'user-other',
    role: 'member',
    user: { id: 'user-other', email: 'other@test.dev', full_name: 'Other User', avatar_url: null },
  },
]

describe('ProjectMembersModal', () => {
  beforeEach(() => {
    useAuthStore.setState({
      user: { ...mockUser, id: 'user-admin' },
      loginContext: null,
      initialized: true,
      accessToken: 'test-token',
    })
    vi.mocked(useTeams).mockReturnValue({
      data: [],
      isLoading: false,
    } as ReturnType<typeof useTeams>)
    vi.mocked(api.get).mockImplementation(async (url: string) => {
      if (url.includes('/member-candidates')) return []
      if (url.includes('/teams')) return []
      if (url.includes('/members')) return members
      return []
    })
    vi.mocked(api.patch).mockResolvedValue({ role: 'viewer' })
    vi.mocked(api.delete).mockResolvedValue({ detail: 'ok' })
  })

  it('shows role dropdown and remove for others when user is explicit project admin', async () => {
    renderWithProviders(
      <ProjectMembersModal
        open
        projectId="proj-1"
        workspaceId="ws-1"
        onClose={vi.fn()}
        onInviteByEmail={vi.fn()}
      />,
    )

    expect(await screen.findByText('(you)')).toBeInTheDocument()
    const roleSelects = screen.getAllByTitle('Change project role')
    expect(roleSelects).toHaveLength(1)
    expect(screen.getAllByTitle('Remove from project')).toHaveLength(1)
  })

  it('hides manage controls for project members and viewers', async () => {
    useAuthStore.setState({
      user: { ...mockUser, id: 'user-other' },
      loginContext: null,
      initialized: true,
      accessToken: 'test-token',
    })
    renderWithProviders(
      <ProjectMembersModal
        open
        projectId="proj-1"
        workspaceId="ws-1"
        onClose={vi.fn()}
        onInviteByEmail={vi.fn()}
      />,
    )

    expect(await screen.findByText('Other User')).toBeInTheDocument()
    expect(screen.queryByTitle('Change project role')).not.toBeInTheDocument()
    expect(screen.queryByTitle('Remove from project')).not.toBeInTheDocument()
    expect(screen.queryByText('Add entire team')).not.toBeInTheDocument()
    expect(screen.queryByText('Invite someone new by email')).not.toBeInTheDocument()
  })

  it('patches role when admin changes another member', async () => {
    const user = userEvent.setup()
    renderWithProviders(
      <ProjectMembersModal
        open
        projectId="proj-1"
        workspaceId="ws-1"
        onClose={vi.fn()}
        onInviteByEmail={vi.fn()}
      />,
    )

    const roleSelect = await screen.findByTitle('Change project role')
    await user.selectOptions(roleSelect, 'viewer')

    await waitFor(() => {
      expect(api.patch).toHaveBeenCalledWith('/projects/proj-1/members/user-other', { role: 'viewer' })
    })
  })
})
