import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { AssignExistingPersonModal } from '@/components/people/AssignExistingPersonModal'
import { api } from '@/lib/api'
import { mockOrgMember2 } from '@tests/mockData'
import { renderWithProviders } from '@tests/renderWithProviders'

vi.mock('@/lib/api', () => ({
  api: { get: vi.fn(), post: vi.fn(), patch: vi.fn(), delete: vi.fn() },
  errorMessage: (err: unknown) => (err instanceof Error ? err.message : 'Error'),
}))

const candidate = {
  user_id: mockOrgMember2().user_id,
  org_role: 'member',
  user: mockOrgMember2().user,
  workspaces: [],
  spaces: [],
  projects: [],
}

const candidateWithAccess = {
  ...candidate,
  spaces: [{ space_id: 'sp-1', space_name: 'Engineering Space', role: 'admin' }],
  projects: [
    {
      project_id: 'proj-1',
      project_name: 'Alpha',
      space_id: 'sp-1',
      role: 'member',
    },
  ],
}

vi.mock('@/lib/queries', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/queries')>()
  return {
    ...actual,
    useWorkspaceMemberCandidates: vi.fn(() => ({
      data: [candidateWithAccess],
      isLoading: false,
    })),
    useSpaces: vi.fn(() => ({
      data: [
        { id: 'sp-1', workspace_id: 'ws-1', name: 'Engineering Space', color: '#2B88EE' },
        { id: 'sp-2', workspace_id: 'ws-1', name: 'Design Space', color: '#4CB782' },
      ],
      isLoading: false,
    })),
    useProjects: vi.fn(() => ({
      data: [
        {
          id: 'proj-1',
          space_id: 'sp-1',
          workspace_id: 'ws-1',
          name: 'Alpha',
          color: '#9B59B6',
          is_archived: false,
        },
        {
          id: 'proj-2',
          space_id: 'sp-2',
          workspace_id: 'ws-1',
          name: 'Beta',
          color: '#E5484D',
          is_archived: false,
        },
      ],
      isLoading: false,
    })),
  }
})

describe('AssignExistingPersonModal', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(api.post).mockResolvedValue({})
    vi.mocked(api.delete).mockResolvedValue({})
  })

  it('adds user as space admin to multiple spaces', async () => {
    const user = userEvent.setup()
    renderWithProviders(
      <AssignExistingPersonModal
        open
        onClose={vi.fn()}
        candidate={candidateWithAccess}
        workspaceId="ws-1"
        orgId="org-1"
      />,
    )

    await user.click(screen.getByRole('checkbox', { name: /Design Space/i }))
    await user.click(screen.getByRole('button', { name: /add as space admin/i }))

    await waitFor(() => {
      expect(api.post).toHaveBeenCalledWith('/spaces/sp-2/members', {
        user_id: candidate.user_id,
        role: 'admin',
      })
    })
  })

  it('removes user from selected spaces', async () => {
    const user = userEvent.setup()
    renderWithProviders(
      <AssignExistingPersonModal
        open
        onClose={vi.fn()}
        candidate={candidateWithAccess}
        workspaceId="ws-1"
        orgId="org-1"
      />,
    )

    await user.click(screen.getByRole('checkbox', { name: /Engineering Space/i }))
    await user.click(screen.getByRole('button', { name: /remove from space/i }))

    await waitFor(() => {
      expect(api.delete).toHaveBeenCalledWith(
        `/spaces/sp-1/members/${candidate.user_id}`,
      )
    })
  })

  it('adds user to multiple projects with selected role', async () => {
    const user = userEvent.setup()
    renderWithProviders(
      <AssignExistingPersonModal
        open
        onClose={vi.fn()}
        candidate={candidateWithAccess}
        workspaceId="ws-1"
        orgId="org-1"
      />,
    )

    await user.click(screen.getByRole('button', { name: /^project$/i }))
    await user.click(screen.getByRole('checkbox', { name: /Beta/i }))
    await user.selectOptions(screen.getByLabelText('Role for new assignments'), 'admin')
    await user.click(screen.getByRole('button', { name: /add to project/i }))

    await waitFor(() => {
      expect(api.post).toHaveBeenCalledWith('/projects/proj-2/members', {
        user_id: candidate.user_id,
        role: 'admin',
      })
    })
  })

  it('adds user to a project as admin when scoped to project admin flow', async () => {
    const user = userEvent.setup()
    renderWithProviders(
      <AssignExistingPersonModal
        open
        onClose={vi.fn()}
        candidate={candidateWithAccess}
        workspaceId="ws-1"
        orgId="org-1"
        assignScope="project"
        scopeProjectIds={['proj-2']}
      />,
    )

    await user.click(screen.getByRole('checkbox', { name: /Beta/i }))
    await user.selectOptions(screen.getByLabelText('Role for new assignments'), 'admin')
    await user.click(screen.getByRole('button', { name: /add to project/i }))

    await waitFor(() => {
      expect(api.post).toHaveBeenCalledWith('/projects/proj-2/members', {
        user_id: candidate.user_id,
        role: 'admin',
      })
    })
  })

  it('adds user to a project as viewer when scoped to project admin flow', async () => {
    const user = userEvent.setup()
    renderWithProviders(
      <AssignExistingPersonModal
        open
        onClose={vi.fn()}
        candidate={candidateWithAccess}
        workspaceId="ws-1"
        orgId="org-1"
        assignScope="project"
        scopeProjectIds={['proj-2']}
      />,
    )

    await user.click(screen.getByRole('checkbox', { name: /Beta/i }))
    await user.selectOptions(screen.getByLabelText('Role for new assignments'), 'viewer')
    await user.click(screen.getByRole('button', { name: /add to project/i }))

    await waitFor(() => {
      expect(api.post).toHaveBeenCalledWith('/projects/proj-2/members', {
        user_id: candidate.user_id,
        role: 'viewer',
      })
    })
  })

  it('removes user from selected projects', async () => {
    const user = userEvent.setup()
    renderWithProviders(
      <AssignExistingPersonModal
        open
        onClose={vi.fn()}
        candidate={candidateWithAccess}
        workspaceId="ws-1"
        orgId="org-1"
      />,
    )

    await user.click(screen.getByRole('button', { name: /^project$/i }))
    await user.click(screen.getByRole('checkbox', { name: /Alpha/i }))
    await user.click(screen.getByRole('button', { name: /remove from project/i }))

    await waitFor(() => {
      expect(api.delete).toHaveBeenCalledWith(
        `/projects/proj-1/members/${candidate.user_id}`,
      )
    })
  })
})
