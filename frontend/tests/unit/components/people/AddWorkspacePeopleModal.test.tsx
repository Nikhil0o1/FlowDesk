import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { AddWorkspacePeopleModal } from '@/components/people/AddWorkspacePeopleModal'
import { api } from '@/lib/api'
import { mockOrgMember2 } from '@tests/mockData'
import { renderWithProviders } from '@tests/renderWithProviders'

vi.mock('@/lib/api', () => ({
  api: { get: vi.fn(), post: vi.fn(), patch: vi.fn(), delete: vi.fn() },
  errorMessage: (err: unknown) => (err instanceof Error ? err.message : 'Error'),
}))

vi.mock('@/components/people/AssignExistingPersonModal', () => ({
  AssignExistingPersonModal: ({
    open,
    candidate,
  }: {
    open: boolean
    candidate: { user?: { full_name?: string } } | null
  }) => (open ? <div>Manage access — {candidate?.user?.full_name}</div> : null),
}))

const candidates = [
  {
    user_id: mockOrgMember2().user_id,
    org_role: 'member',
    user: mockOrgMember2().user,
    workspaces: [],
    spaces: [],
    projects: [],
  },
  {
    user_id: 'user-3',
    org_role: 'member',
    user: {
      id: 'user-3',
      email: 'other-ws@example.com',
      full_name: 'Other WS User',
      avatar_url: null,
    },
    workspaces: [
      { workspace_id: 'ws-2', workspace_name: 'Other Workspace', role: 'member' },
    ],
    spaces: [],
    projects: [],
  },
  {
    user_id: 'user-4',
    org_role: 'member',
    user: {
      id: 'user-4',
      email: 'multi@example.com',
      full_name: 'Multi Role User',
      avatar_url: null,
    },
    workspaces: [{ workspace_id: 'ws-1', workspace_name: 'Brightcone', role: 'member' }],
    spaces: [{ space_id: 'sp-1', space_name: 'Backend', role: 'admin' }],
    projects: [{ project_id: 'proj-1', project_name: 'Getting Started', space_id: 'sp-1', role: 'member' }],
  },
]

vi.mock('@/lib/queries', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/queries')>()
  return {
    ...actual,
    useWorkspaceMemberCandidates: vi.fn(() => ({
      data: candidates,
      isLoading: false,
    })),
  }
})

describe('AddWorkspacePeopleModal', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(api.post).mockResolvedValue({})
  })

  it('shows name, email, role, workspace, and manage button', async () => {
    renderWithProviders(
      <AddWorkspacePeopleModal open onClose={() => {}} workspaceId="ws-1" orgId="org-1" />,
    )

    expect(await screen.findByText('Jane Doe')).toBeInTheDocument()
    expect(screen.getByText('jane@example.com')).toBeInTheDocument()
    expect(screen.getByText('Other WS User')).toBeInTheDocument()
    expect(screen.getByText('other-ws@example.com')).toBeInTheDocument()
    expect(screen.getByText('Organization Member')).toBeInTheDocument()
    expect(screen.getByText('Not in this workspace')).toBeInTheDocument()
    expect(screen.getAllByText('Other Workspace').length).toBeGreaterThanOrEqual(1)
    expect(screen.getAllByText('Workspace Member').length).toBeGreaterThanOrEqual(1)
    expect(screen.getAllByRole('button', { name: 'Manage' })).toHaveLength(3)
  })

  it('shows multiple role chips for users with several assignments', async () => {
    renderWithProviders(
      <AddWorkspacePeopleModal open onClose={() => {}} workspaceId="ws-1" orgId="org-1" />,
    )

    expect(await screen.findByText('Multi Role User')).toBeInTheDocument()
    expect(screen.getByText('Space Admin')).toBeInTheDocument()
    expect(screen.getByText('Backend')).toBeInTheDocument()
    expect(screen.getByText('Project Member')).toBeInTheDocument()
    expect(screen.getByText('Getting Started')).toBeInTheDocument()
    expect(screen.getAllByText('Workspace Member').length).toBeGreaterThanOrEqual(1)
  })

  it('opens manage dialog when manage is clicked', async () => {
    const user = userEvent.setup()
    renderWithProviders(
      <AddWorkspacePeopleModal open onClose={() => {}} workspaceId="ws-1" orgId="org-1" />,
    )

    await user.click((await screen.findAllByRole('button', { name: 'Manage' }))[0]!)
    expect(await screen.findByText(/Manage access — Jane Doe/)).toBeInTheDocument()
  })
})
