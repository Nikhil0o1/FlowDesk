import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { api } from '@/lib/api'
import { useAuthStore } from '@/stores/auth'

vi.unmock('@/lib/queries')

import {
  analyticsQueryTail,
  useAnalyticsActivityFeed,
  useAnalyticsAlerts,
  useAnalyticsContributionHeatmap,
  useAnalyticsDevices,
  useAnalyticsHeatmap,
  useOrgDashboard,
  useWorkspaceDashboard,
  useSpaceDashboard,
  useProjectDashboard,
  useProjectMemberDashboard,
  useAnalyticsOverview,
  useAnalyticsStatusDistribution,
  useAnalyticsTimeline,
  useAnalyticsTeamActivity,
  useAnalyticsUserDetail,
  useAnalyticsTrends,
  useAnalyticsUsers,
  useMyAnalyticsOverview,
  useMyBenchmarks,
  useMyCollaboration,
  useMyDeadlinePerformance,
  useMyPersonalActivity,
  useMyPriorityAnalysis,
  useMyProductivityTrend,
  useMyProjectContribution,
  useMyTaskTrends,
  useMyTimeDistribution,
  useMyWorkPattern,
} from '@/lib/queries'

function wrapper() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  })
  return ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  )
}

describe('dashboard query hooks', () => {
  beforeEach(() => {
    vi.mocked(api.get).mockReset()
    vi.mocked(api.get).mockResolvedValue({})
  })

  it.each([
    [() => useOrgDashboard('org-1'), '/organizations/org-1/dashboard'],
    [() => useWorkspaceDashboard('ws-1'), '/workspaces/ws-1/dashboard'],
    [() => useSpaceDashboard('sp-1'), '/spaces/sp-1/dashboard'],
    [() => useProjectDashboard('pr-1'), '/projects/pr-1/dashboard'],
    [() => useProjectMemberDashboard('pr-1'), '/projects/pr-1/member-dashboard'],
  ])('loads dashboard endpoint', async (useHook, path) => {
    const { result } = renderHook(useHook, { wrapper: wrapper() })
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(api.get).toHaveBeenCalledWith(path)
  })
})

describe('analyticsQueryTail', () => {
  it('serializes filter params', () => {
    expect(analyticsQueryTail({ workspace_id: 'ws-1', empty: '' })).toBe('&workspace_id=ws-1')
    expect(analyticsQueryTail({})).toBe('')
  })
})

describe('analytics query hooks', () => {
  beforeEach(() => {
    vi.mocked(api.get).mockReset()
    vi.mocked(api.get).mockResolvedValue({})
  })

  it.each([
    [() => useAnalyticsOverview('org-1'), '/analytics/overview?organization_id=org-1'],
    [() => useAnalyticsTimeline('org-1'), '/analytics/timeline?organization_id=org-1'],
    [() => useAnalyticsStatusDistribution('org-1'), '/analytics/status-distribution?organization_id=org-1'],
    [() => useAnalyticsUsers('org-1'), '/analytics/users?organization_id=org-1'],
    [() => useAnalyticsActivityFeed('org-1'), '/analytics/activity-feed?organization_id=org-1'],
    [() => useAnalyticsTeamActivity('org-1', 'workspace'), '/analytics/team-activity?organization_id=org-1&group_by=workspace'],
    [() => useAnalyticsUserDetail('org-1', 'user-1'), '/analytics/users/user-1?organization_id=org-1'],
    [() => useAnalyticsTrends('org-1', 7), '/analytics/trends?organization_id=org-1&days=7'],
    [() => useAnalyticsHeatmap('org-1', 14), '/analytics/heatmap?organization_id=org-1&days=14'],
    [
      () => useAnalyticsContributionHeatmap('org-1', 30),
      '/analytics/contribution-heatmap?organization_id=org-1&days=30',
    ],
    [() => useAnalyticsDevices('org-1', 7), '/analytics/devices?organization_id=org-1&days=7'],
    [() => useAnalyticsAlerts('org-1'), '/analytics/alerts?organization_id=org-1'],
  ])('loads org analytics endpoint', async (useHook, path) => {
    const { result } = renderHook(useHook, { wrapper: wrapper() })
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(api.get).toHaveBeenCalledWith(path)
  })

  it('skips org analytics when org id is missing', () => {
    renderHook(() => useAnalyticsOverview(undefined), { wrapper: wrapper() })
    expect(api.get).not.toHaveBeenCalled()
  })
})

describe('my analytics query hooks', () => {
  beforeEach(() => {
    vi.mocked(api.get).mockReset()
    vi.mocked(api.get).mockResolvedValue({})
    useAuthStore.setState({
      user: { id: 'user-1', email: 'me@example.com', full_name: 'Me' } as never,
    })
  })

  it.each([
    [() => useMyAnalyticsOverview(), '/my-analytics/overview'],
    [() => useMyProductivityTrend('week'), '/my-analytics/productivity-trend?period=week'],
    [() => useMyTaskTrends(), '/my-analytics/task-trends'],
    [() => useMyDeadlinePerformance(90), '/my-analytics/deadline-performance?days=90'],
    [() => useMyPersonalActivity(20), '/my-analytics/activity?limit=20'],
    [() => useMyWorkPattern(30), '/my-analytics/work-pattern?days=30'],
    [() => useMyTimeDistribution(30), '/my-analytics/time-distribution?days=30'],
    [() => useMyProjectContribution(30), '/my-analytics/project-contribution?days=30'],
    [() => useMyCollaboration(30), '/my-analytics/collaboration?days=30'],
    [() => useMyPriorityAnalysis(30), '/my-analytics/priority-analysis?days=30'],
    [() => useMyBenchmarks('month'), '/my-analytics/benchmarks?period=month'],
  ])('loads personal analytics endpoint', async (useHook, path) => {
    const { result } = renderHook(useHook, { wrapper: wrapper() })
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(api.get).toHaveBeenCalledWith(path)
  })
})
