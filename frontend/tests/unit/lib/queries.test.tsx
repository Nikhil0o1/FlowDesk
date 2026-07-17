import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { api } from '@/lib/api'
import { mockOrg, mockWorkspace } from '@tests/fixtures'
import { emptyPage, mockChannel, mockFormDef, mockOrgMember, mockProject, mockSprint, mockStatus, mockTask, mockTeam, mockWhiteboard } from '@tests/mockData'

vi.unmock('@/lib/queries')

import {
  useChannels,
  useCurrentContext,
  useFolderGoals,
  useForms,
  useGoal,
  useGoalActivity,
  useGoalFolder,
  useGoalFolderAnalytics,
  useGoalFolders,
  useGoalProgress,
  useGoals,
  useGoalsAccess,
  useMemberAccess,
  useOrganizationMembers,
  useOrganizations,
  useProject,
  useProjectDashboard,
  useProjectMembers,
  useProjectMemberDashboard,
  useProjectTasks,
  useProjects,
  useRunningTimer,
  useSpaceMembers,
  useSpaceDashboard,
  useSpaces,
  useSprints,
  useStatuses,
  useTargetTasks,
  useTaskLists,
  useTeams,
  useUnreadNotifications,
  useWhiteboards,
  useWorkspaceMembers,
} from '@/lib/queries'

const mockSetOrg = vi.fn()
const mockSetWorkspace = vi.fn()
const workspaceState = vi.hoisted(() => ({
  currentOrgId: 'org-1',
  currentWorkspaceId: 'ws-1',
}))

vi.mock('@/stores/workspace', () => ({
  useWorkspaceStore: () => ({
    currentOrgId: workspaceState.currentOrgId,
    currentWorkspaceId: workspaceState.currentWorkspaceId,
    setOrg: mockSetOrg,
    setWorkspace: mockSetWorkspace,
  }),
}))

function wrapper() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  })
  return ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  )
}

describe('useOrganizations', () => {
  beforeEach(() => {
    vi.mocked(api.get).mockReset()
  })

  it('loads organizations from the API', async () => {
    const orgs = [mockOrg]
    vi.mocked(api.get).mockResolvedValue(orgs)
    const { result } = renderHook(() => useOrganizations(), { wrapper: wrapper() })
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(result.current.data).toEqual(orgs)
    expect(api.get).toHaveBeenCalledWith('/organizations')
  })
})

describe('useCurrentContext', () => {
  beforeEach(() => {
    vi.mocked(api.get).mockReset()
    workspaceState.currentOrgId = 'org-1'
    workspaceState.currentWorkspaceId = 'ws-1'
    mockSetOrg.mockClear()
    mockSetWorkspace.mockClear()
  })

  it('resolves org and workspace from API data', async () => {
    vi.mocked(api.get).mockImplementation(async (url: string) => {
      if (url === '/organizations') return [mockOrg]
      if (url.includes('/workspaces')) return [mockWorkspace]
      return []
    })
    const { result } = renderHook(() => useCurrentContext(), { wrapper: wrapper() })
    await waitFor(() => expect(result.current.org?.name).toBe('Acme Corp'))
    expect(result.current.workspace?.name).toBe('Main Workspace')
  })

  it('syncs stale org and workspace ids from API data', async () => {
    workspaceState.currentOrgId = 'stale-org'
    workspaceState.currentWorkspaceId = 'stale-ws'
    vi.mocked(api.get).mockImplementation(async (url: string) => {
      if (url === '/organizations') return [mockOrg]
      if (url.includes('/workspaces')) return [mockWorkspace]
      return []
    })
    renderHook(() => useCurrentContext(), { wrapper: wrapper() })
    await waitFor(() => expect(mockSetOrg).toHaveBeenCalledWith('org-1'))
    await waitFor(() => expect(mockSetWorkspace).toHaveBeenCalledWith('ws-1'))
  })
})

describe('useProject', () => {
  beforeEach(() => {
    vi.mocked(api.get).mockReset()
    vi.mocked(api.get).mockResolvedValue({})
  })

  it('does not fetch when projectId is undefined', () => {
    renderHook(() => useProject(undefined), { wrapper: wrapper() })
    expect(api.get).not.toHaveBeenCalled()
  })

  it('fetches a project when id is provided', async () => {
    vi.mocked(api.get).mockImplementation(async (url: string) => {
      if (url === '/projects/proj-1') return mockProject
      return {}
    })
    renderHook(() => useProject('proj-1'), { wrapper: wrapper() })
    await waitFor(() => expect(api.get).toHaveBeenCalledWith('/projects/proj-1'))
  })
})

describe('workspace hooks', () => {
  beforeEach(() => {
    vi.mocked(api.get).mockReset()
  })

  it.each([
    ['useSpaces', () => useSpaces('ws-1'), '/workspaces/ws-1/spaces', [{ id: 'space-1' }]],
    ['useProjects', () => useProjects('ws-1'), '/workspaces/ws-1/projects', [mockProject]],
    ['useChannels', () => useChannels('ws-1'), '/workspaces/ws-1/channels', [mockChannel()]],
    ['useSprints', () => useSprints('ws-1'), '/workspaces/ws-1/sprints', [mockSprint()]],
    ['useGoals', () => useGoals('ws-1'), '/workspaces/ws-1/goals', [{ id: 'goal-1' }]],
    ['useGoalsAccess', () => useGoalsAccess('ws-1'), '/workspaces/ws-1/goals/access', { can_access: true }],
    ['useGoalFolders', () => useGoalFolders('ws-1'), '/workspaces/ws-1/goal-folders', [{ id: 'folder-1' }]],
    [
      'useGoalFolders archived',
      () => useGoalFolders('ws-1', true),
      '/workspaces/ws-1/goal-folders?include_archived=true',
      [{ id: 'folder-1' }],
    ],
    ['useTeams', () => useTeams('ws-1'), '/workspaces/ws-1/teams', [mockTeam()]],
    ['useForms', () => useForms('ws-1'), '/workspaces/ws-1/forms', [mockFormDef()]],
    ['useWhiteboards', () => useWhiteboards('ws-1'), '/workspaces/ws-1/whiteboards', [mockWhiteboard()]],
    ['useWorkspaceMembers', () => useWorkspaceMembers('ws-1'), '/workspaces/ws-1/members', [mockOrgMember()]],
    ['useOrganizationMembers', () => useOrganizationMembers('org-1'), '/organizations/org-1/members', [mockOrgMember()]],
  ] as const)('%s fetches data', async (_name, hook, path, payload) => {
    vi.mocked(api.get).mockResolvedValue(payload)
    const { result } = renderHook(hook, { wrapper: wrapper() })
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(api.get).toHaveBeenCalledWith(path)
  })
})

describe('goal hooks', () => {
  beforeEach(() => {
    vi.mocked(api.get).mockReset()
    vi.mocked(api.get).mockResolvedValue({})
  })

  it.each([
    ['useGoalFolder', () => useGoalFolder('folder-1'), '/goal-folders/folder-1'],
    ['useGoalFolderAnalytics', () => useGoalFolderAnalytics('folder-1'), '/goal-folders/folder-1/analytics'],
    ['useFolderGoals', () => useFolderGoals('folder-1'), '/goal-folders/folder-1/goals'],
    [
      'useFolderGoals status',
      () => useFolderGoals('folder-1', 'active'),
      '/goal-folders/folder-1/goals?status=active',
    ],
    ['useGoal', () => useGoal('goal-1'), '/goals/goal-1'],
    ['useGoalActivity', () => useGoalActivity('goal-1'), '/goals/goal-1/activity'],
    ['useGoalProgress', () => useGoalProgress('goal-1'), '/goals/goal-1/progress'],
    ['useTargetTasks', () => useTargetTasks('target-1'), '/targets/target-1/tasks'],
  ] as const)('%s fetches data', async (_name, hook, path) => {
    const { result } = renderHook(hook, { wrapper: wrapper() })
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(api.get).toHaveBeenCalledWith(path)
  })

  it('skips goal fetches when id is missing', () => {
    renderHook(() => useGoal(undefined), { wrapper: wrapper() })
    renderHook(() => useGoalFolders(undefined), { wrapper: wrapper() })
    renderHook(() => useGoalsAccess(undefined), { wrapper: wrapper() })
    expect(api.get).not.toHaveBeenCalled()
  })

  it('skips useGoals when disabled', () => {
    renderHook(() => useGoals('ws-1', false), { wrapper: wrapper() })
    expect(api.get).not.toHaveBeenCalled()
  })

  it('skips useGoalFolders when disabled', () => {
    renderHook(() => useGoalFolders('ws-1', false, false), { wrapper: wrapper() })
    expect(api.get).not.toHaveBeenCalled()
  })
})

describe('project hooks', () => {
  beforeEach(() => {
    vi.mocked(api.get).mockReset()
    vi.mocked(api.post).mockReset()
    vi.mocked(api.post).mockResolvedValue({ imported: 0 })
  })

  it('useStatuses fetches project statuses', async () => {
    vi.mocked(api.get).mockResolvedValue([mockStatus])
    const { result } = renderHook(() => useStatuses('proj-1'), { wrapper: wrapper() })
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(api.get).toHaveBeenCalledWith('/projects/proj-1/statuses')
  })

  it('useTaskLists fetches project lists', async () => {
    vi.mocked(api.get).mockResolvedValue([])
    const { result } = renderHook(() => useTaskLists('proj-1'), { wrapper: wrapper() })
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(api.get).toHaveBeenCalledWith('/projects/proj-1/lists')
  })

  it('useProjectTasks fetches paginated tasks', async () => {
    vi.mocked(api.get).mockResolvedValue({ ...emptyPage, items: [mockTask()] })
    const { result } = renderHook(() => useProjectTasks('proj-1', '&status=open'), { wrapper: wrapper() })
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(api.get).toHaveBeenCalledWith('/projects/proj-1/tasks?page_size=500&status=open')
  })

  it('syncs GitHub issues when loading project tasks', async () => {
    vi.mocked(api.post).mockResolvedValue({ imported: 0 })
    vi.mocked(api.get).mockResolvedValue({ ...emptyPage, items: [mockTask()] })
    const { result } = renderHook(() => useProjectTasks('proj-sync-1'), { wrapper: wrapper() })
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(api.post).toHaveBeenCalledWith('/github/projects/proj-sync-1/sync-issues')
  })

  it('still loads tasks when GitHub sync fails', async () => {
    vi.mocked(api.post).mockRejectedValue(new Error('no repo'))
    vi.mocked(api.get).mockResolvedValue({ ...emptyPage, items: [mockTask()] })
    const { result } = renderHook(() => useProjectTasks('proj-sync-fail'), { wrapper: wrapper() })
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(api.get).toHaveBeenCalledWith('/projects/proj-sync-fail/tasks?page_size=500')
  })

  it('skips GitHub sync within cooldown', async () => {
    vi.mocked(api.post).mockResolvedValue({ imported: 0 })
    vi.mocked(api.get).mockResolvedValue(emptyPage)
    const { result } = renderHook(() => useProjectTasks('proj-cooldown'), { wrapper: wrapper() })
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(api.post).toHaveBeenCalledTimes(1)
    await result.current.refetch()
    await waitFor(() => expect(result.current.isFetched).toBe(true))
    expect(api.post).toHaveBeenCalledTimes(1)
  })
})

describe('dashboard hooks', () => {
  beforeEach(() => {
    vi.mocked(api.get).mockReset()
  })

  it.each([
    ['useSpaceDashboard', () => useSpaceDashboard('sp-1'), '/spaces/sp-1/dashboard', { task_count: 0 }],
    ['useProjectDashboard', () => useProjectDashboard('proj-1'), '/projects/proj-1/dashboard', { task_count: 0 }],
    [
      'useProjectMemberDashboard',
      () => useProjectMemberDashboard('proj-1'),
      '/projects/proj-1/member-dashboard',
      { assigned_count: 0 },
    ],
  ] as const)('%s fetches dashboard data', async (_name, hook, path, payload) => {
    vi.mocked(api.get).mockResolvedValue(payload)
    const { result } = renderHook(hook, { wrapper: wrapper() })
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(api.get).toHaveBeenCalledWith(path)
  })
})

describe('useRunningTimer', () => {
  beforeEach(() => {
    vi.mocked(api.get).mockReset()
  })

  it('fetches the current timer', async () => {
    const entry = { id: 't1', task_id: 'task-1' }
    vi.mocked(api.get).mockResolvedValue(entry)
    const { result } = renderHook(() => useRunningTimer(), { wrapper: wrapper() })
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(api.get).toHaveBeenCalledWith('/timer/current')
  })
})

describe('useUnreadNotifications', () => {
  beforeEach(() => {
    vi.mocked(api.get).mockReset()
  })

  it('fetches unread notification count', async () => {
    vi.mocked(api.get).mockResolvedValue({ count: 4 })
    const { result } = renderHook(() => useUnreadNotifications(), { wrapper: wrapper() })
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(result.current.data?.count).toBe(4)
  })
})

describe('scoped member hooks', () => {
  beforeEach(() => {
    vi.mocked(api.get).mockReset()
  })

  it('useMemberAccess calls scoped workspace route from URL params', async () => {
    vi.mocked(api.get).mockResolvedValue({ user_id: 'u-2', org_role: 'member' })
    const params = new URLSearchParams('workspace=ws-1')
    const { result } = renderHook(
      () => useMemberAccess('org-1', 'u-2', { level: 'workspace', workspaceId: 'ws-1' }, params),
      { wrapper: wrapper() },
    )
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(api.get).toHaveBeenCalledWith('/workspaces/ws-1/members/u-2/access')
  })

  it('useSpaceMembers and useProjectMembers fetch scoped rosters', async () => {
    vi.mocked(api.get).mockResolvedValue([{ user_id: 'u-1' }])
    const space = renderHook(() => useSpaceMembers('sp-1'), { wrapper: wrapper() })
    const project = renderHook(() => useProjectMembers('p-1'), { wrapper: wrapper() })
    await waitFor(() => expect(space.result.current.isSuccess).toBe(true))
    await waitFor(() => expect(project.result.current.isSuccess).toBe(true))
    expect(api.get).toHaveBeenCalledWith('/spaces/sp-1/members')
    expect(api.get).toHaveBeenCalledWith('/projects/p-1/members')
  })
})
