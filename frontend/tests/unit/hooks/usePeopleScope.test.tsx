import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { MemoryRouter } from 'react-router-dom'

import { usePeopleScope } from '@/hooks/usePeopleScope'
import { useCurrentContext, useUserRoles } from '@/lib/queries'
import { mockOrgMember, mockOrgMember2 } from '@tests/mockData'

const workspaceMembers = [mockOrgMember({ role: 'admin' })]
const orgMembers = [mockOrgMember(), mockOrgMember2()]

vi.mock('@/lib/queries', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/queries')>()
  return {
    ...actual,
    useCurrentContext: vi.fn(),
    useUserRoles: vi.fn(),
    useOrganizationMembers: vi.fn(() => ({
      data: orgMembers,
      isLoading: false,
    })),
    useWorkspaceMembers: vi.fn((workspaceId: string | undefined) => ({
      data: workspaceId ? workspaceMembers : [],
      isLoading: false,
    })),
    useSpaceMembers: vi.fn(() => ({ data: [], isLoading: false })),
    useProjectMembers: vi.fn(() => ({ data: [], isLoading: false })),
  }
})

const workspaceAdminContext = {
  org: { id: 'org-1', name: 'Acme Corp', my_role: 'member' as const },
  orgs: [],
  workspace: {
    id: 'ws-1',
    organization_id: 'org-1',
    name: 'Main Workspace',
    my_role: 'admin' as const,
  },
  workspaces: [
    {
      id: 'ws-1',
      organization_id: 'org-1',
      name: 'Main Workspace',
      my_role: 'admin' as const,
    },
  ],
  isLoading: false,
}

const workspaceAdminRoles = {
  highest_role: 'workspace_admin',
  org_role: 'member',
  org_name: 'Acme Corp',
  workspace_roles: [{ workspace_id: 'ws-1', workspace_name: 'Main Workspace', role: 'admin' }],
  space_roles: [],
  project_roles: [],
}

const projectAdminContext = {
  ...workspaceAdminContext,
  workspace: { ...workspaceAdminContext.workspace, my_role: 'member' as const },
  workspaces: [{ ...workspaceAdminContext.workspaces[0], my_role: 'member' as const }],
}

/** Project admin of X, plain member of Y — both in ws-1. */
const mixedProjectRoles = {
  highest_role: 'project_admin',
  org_role: 'member',
  org_name: 'Acme Corp',
  workspace_roles: [],
  space_roles: [],
  project_roles: [
    { project_id: 'p-x', project_name: 'X', space_id: 's1', workspace_id: 'ws-1', role: 'admin' },
    { project_id: 'p-y', project_name: 'Y', space_id: 's1', workspace_id: 'ws-1', role: 'member' },
  ],
}

function setMocks(context: unknown, roles: unknown) {
  vi.mocked(useCurrentContext).mockReturnValue(context as ReturnType<typeof useCurrentContext>)
  vi.mocked(useUserRoles).mockReturnValue({
    data: roles,
    isLoading: false,
    isSuccess: true,
  } as ReturnType<typeof useUserRoles>)
}

function wrapper(initialEntries = ['/app/teams?tab=people']) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  })
  return ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={initialEntries}>{children}</MemoryRouter>
    </QueryClientProvider>
  )
}

describe('usePeopleScope — workspace admin', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    setMocks(workspaceAdminContext, workspaceAdminRoles)
  })

  it('lists only workspace members, not all org members', async () => {
    const { result } = renderHook(() => usePeopleScope(), { wrapper: wrapper() })

    await waitFor(() => expect(result.current.isLoading).toBe(false))

    expect(result.current.isWorkspaceAdmin).toBe(true)
    expect(result.current.scopedWorkspaceId).toBe('ws-1')
    expect(result.current.panelScope).toEqual({ level: 'workspace', workspaceId: 'ws-1' })
    expect(result.current.members).toHaveLength(1)
    expect(result.current.members[0]?.user_id).toBe('user-1')
  })
})

describe('usePeopleScope — project admin with member project', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    setMocks(projectAdminContext, mixedProjectRoles)
  })

  it('defaults to the admin project with admin scope role', async () => {
    const { result } = renderHook(() => usePeopleScope(), { wrapper: wrapper() })

    await waitFor(() => expect(result.current.isLoading).toBe(false))

    expect(result.current.isProjectAdminOnly).toBe(true)
    expect(result.current.scopedProjectId).toBe('p-x')
    expect(result.current.scopedProjectRole).toBe('admin')
  })

  it('honors a member-project URL filter and reports the member role', async () => {
    const { result } = renderHook(() => usePeopleScope(), {
      wrapper: wrapper(['/app/teams?tab=people&project=p-y']),
    })

    await waitFor(() => expect(result.current.isLoading).toBe(false))

    expect(result.current.scopedProjectId).toBe('p-y')
    expect(result.current.scopedProjectRole).toBe('member')
    expect(result.current.panelScope).toEqual({ level: 'project', projectId: 'p-y' })
    expect(result.current.allProjects).toHaveLength(2)
  })

  it('falls back to the admin project for an unknown project filter', async () => {
    const { result } = renderHook(() => usePeopleScope(), {
      wrapper: wrapper(['/app/teams?tab=people&project=p-unknown']),
    })

    await waitFor(() => expect(result.current.isLoading).toBe(false))

    expect(result.current.scopedProjectId).toBe('p-x')
    expect(result.current.scopedProjectRole).toBe('admin')
  })
})
