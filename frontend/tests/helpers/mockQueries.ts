import { vi } from 'vitest'

import { mockCurrentContext } from '@tests/fixtures'

const emptyList = { data: [] as unknown[], isLoading: false }
const emptyPage = { items: [] as unknown[], total: 0, page: 1, page_size: 50 }

vi.mock('@/lib/queries', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/queries')>()
  return {
    ...actual,
    useOrganizations: vi.fn(() => emptyList),
    useCurrentContext: vi.fn(() => mockCurrentContext()),
    useSpaces: vi.fn(() => emptyList),
    useProjects: vi.fn(() => emptyList),
    useProject: vi.fn(() => ({ data: undefined, isLoading: false })),
    useStatuses: vi.fn(() => emptyList),
    useTaskLists: vi.fn(() => emptyList),
    useProjectTasks: vi.fn(() => ({ data: emptyPage, isLoading: false })),
    useChannels: vi.fn(() => emptyList),
    useSprints: vi.fn(() => emptyList),
    useRunningTimer: vi.fn(() => ({ data: null, isLoading: false })),
    useTeams: vi.fn(() => emptyList),
    useWhiteboards: vi.fn(() => emptyList),
    useForms: vi.fn(() => emptyList),
    useWorkspaceMembers: vi.fn(() => emptyList),
    useOrganizationMembers: vi.fn(() => emptyList),
    useUnreadNotifications: vi.fn(() => ({ data: { count: 0 }, isLoading: false })),
    useUserRoles: vi.fn(() => ({ data: undefined, isLoading: false })),
    useOrgDashboard: vi.fn(() => ({ data: undefined, isLoading: false })),
    useWorkspaceDashboard: vi.fn(() => ({ data: undefined, isLoading: false })),
    useSpaceDashboard: vi.fn(() => ({ data: undefined, isLoading: false })),
    useProjectDashboard: vi.fn(() => ({ data: undefined, isLoading: false })),
    useProjectMemberDashboard: vi.fn(() => ({ data: undefined, isLoading: false })),
    useMemberAccess: vi.fn(() => ({ data: undefined, isLoading: false })),
  }
})
