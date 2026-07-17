import { useQuery } from '@tanstack/react-query'
import { useEffect } from 'react'

import { api, ApiError } from './api'
import { memberAccessApiPath, resolvePeoplePanelScope, type PeoplePanelScope } from './peopleRoutes'
import type {
  AnalyticsAlerts,
  AnalyticsContributionHeatmap,
  AnalyticsHeatmap,
  AnalyticsOverview,
  AnalyticsStatusDistribution,
  AnalyticsTimeline,
  AnalyticsTrends,
  Activity,
  Channel,
  CustomStatus,
  FormDef,
  Goal,
  GoalAccess,
  GoalDetail,
  GoalFolder,
  GoalFolderAnalytics,
  GoalFolderDetail,
  GoalProgress,
  OrgDashboard,
  Organization,
  OrgMember,
  MemberAccessDetail,
  Page,
  Project,
  ProjectDashboard,
  ProjectMemberDashboard,
  Space,
  SpaceDashboard,
  DeviceAnalytics,
  MyAnalyticsOverviewResponse,
  MyCollaboration,
  MyDeadlinePerformance,
  MyPersonalActivity,
  MyPersonalBenchmarks,
  MyPriorityAnalysis,
  MyProductivityTrend,
  MyProjectContribution,
  MyTaskTrends,
  MyTimeDistribution,
  MyWorkPattern,
  PresenceActivityItem,
  PresenceUsersPage,
  Sprint,
  TeamActivityGroup,
  UserPresenceDetail,
  Task,
  TaskList,
  Team,
  TimeEntry,
  UserRoleSummary,
  Whiteboard,
  Workspace,
  WorkspaceDashboard,
  WorkspaceMemberCandidate,
} from './types'
import { useWorkspaceStore } from '../stores/workspace'
import { useAuthStore } from '../stores/auth'

const githubIssueSyncAt: Record<string, number> = {}
const GITHUB_ISSUE_SYNC_COOLDOWN_MS = 90_000

/** Poll GitHub for issues missing from FlowDesk (webhooks often miss on localhost). */
async function syncGithubIssuesIfDue(projectId: string): Promise<void> {
  const now = Date.now()
  if (now - (githubIssueSyncAt[projectId] ?? 0) < GITHUB_ISSUE_SYNC_COOLDOWN_MS) return
  githubIssueSyncAt[projectId] = now
  try {
    await api.post<{ imported: number }>(`/github/projects/${projectId}/sync-issues`)
  } catch {
    // Repo may not be linked or GitHub token invalid — task list still loads.
  }
}

export function useOrganizations() {
  return useQuery({
    queryKey: ['organizations'],
    queryFn: () => api.get<Organization[]>('/organizations'),
  })
}

/** Resolve current org/workspace selection, defaulting to the first available. */
export function useCurrentContext() {
  const orgs = useOrganizations()
  const { currentOrgId, currentWorkspaceId, setOrg, setWorkspace } = useWorkspaceStore()

  const org = orgs.data?.find((o) => o.id === currentOrgId) ?? orgs.data?.[0] ?? null

  useEffect(() => {
    if (org && org.id !== currentOrgId) setOrg(org.id)
  }, [org?.id, currentOrgId, setOrg])

  const workspaces = useQuery({
    queryKey: ['workspaces', org?.id],
    queryFn: () => api.get<Workspace[]>(`/organizations/${org!.id}/workspaces`),
    enabled: !!org,
  })

  const workspace =
    workspaces.data?.find((w) => w.id === currentWorkspaceId) ?? workspaces.data?.[0] ?? null

  useEffect(() => {
    if (workspace && workspace.id !== currentWorkspaceId) setWorkspace(workspace.id)
  }, [workspace?.id, currentWorkspaceId, setWorkspace])

  return {
    org,
    orgs: orgs.data ?? [],
    workspace,
    workspaces: workspaces.data ?? [],
    isLoading: orgs.isLoading || workspaces.isLoading,
  }
}

export function useSpaces(workspaceId: string | undefined) {
  return useQuery({
    queryKey: ['spaces', workspaceId],
    queryFn: () => api.get<Space[]>(`/workspaces/${workspaceId}/spaces`),
    enabled: !!workspaceId,
  })
}

export function useProjects(workspaceId: string | undefined) {
  return useQuery({
    queryKey: ['projects', workspaceId],
    queryFn: () => api.get<Project[]>(`/workspaces/${workspaceId}/projects`),
    enabled: !!workspaceId,
  })
}

export function useProject(projectId: string | undefined) {
  return useQuery({
    queryKey: ['project', projectId],
    queryFn: () => api.get<Project>(`/projects/${projectId}`),
    enabled: !!projectId,
  })
}

export function useStatuses(projectId: string | undefined) {
  return useQuery({
    queryKey: ['statuses', projectId],
    queryFn: () => api.get<CustomStatus[]>(`/projects/${projectId}/statuses`),
    enabled: !!projectId,
  })
}

export function useTaskLists(projectId: string | undefined) {
  return useQuery({
    queryKey: ['lists', projectId],
    queryFn: () => api.get<TaskList[]>(`/projects/${projectId}/lists`),
    enabled: !!projectId,
  })
}

export function useProjectTasks(projectId: string | undefined, params = '') {
  return useQuery({
    queryKey: ['tasks', projectId, params],
    queryFn: async () => {
      if (projectId) await syncGithubIssuesIfDue(projectId)
      return api.get<Page<Task>>(`/projects/${projectId}/tasks?page_size=500${params}`)
    },
    enabled: !!projectId,
  })
}

export function useChannels(workspaceId: string | undefined) {
  return useQuery({
    queryKey: ['channels', workspaceId],
    queryFn: () => api.get<Channel[]>(`/workspaces/${workspaceId}/channels`),
    enabled: !!workspaceId,
  })
}

export function useSprints(workspaceId: string | undefined) {
  return useQuery({
    queryKey: ['sprints', workspaceId],
    queryFn: () => api.get<Sprint[]>(`/workspaces/${workspaceId}/sprints`),
    enabled: !!workspaceId,
  })
}

export function useGoalsAccess(workspaceId: string | undefined) {
  return useQuery({
    queryKey: ['goals-access', workspaceId],
    queryFn: () => api.get<GoalAccess>(`/workspaces/${workspaceId}/goals/access`),
    enabled: !!workspaceId,
  })
}

export function useGoals(workspaceId: string | undefined, enabled = true) {
  return useQuery({
    queryKey: ['goals', workspaceId],
    queryFn: () => api.get<Goal[]>(`/workspaces/${workspaceId}/goals`),
    enabled: !!workspaceId && enabled,
  })
}

export function useGoalFolders(workspaceId: string | undefined, includeArchived = false, enabled = true) {
  return useQuery({
    queryKey: ['goal-folders', workspaceId, includeArchived ? 'archived' : 'active'],
    queryFn: () =>
      api.get<GoalFolder[]>(
        `/workspaces/${workspaceId}/goal-folders${includeArchived ? '?include_archived=true' : ''}`,
      ),
    enabled: !!workspaceId && enabled,
  })
}

export function useGoalFolder(folderId: string | undefined) {
  return useQuery({
    queryKey: ['goal-folder', folderId],
    queryFn: () => api.get<GoalFolderDetail>(`/goal-folders/${folderId}`),
    enabled: !!folderId,
  })
}

export function useGoalFolderAnalytics(folderId: string | undefined) {
  return useQuery({
    queryKey: ['goal-folder-analytics', folderId],
    queryFn: () => api.get<GoalFolderAnalytics>(`/goal-folders/${folderId}/analytics`),
    enabled: !!folderId,
  })
}

export function useFolderGoals(folderId: string | undefined, status?: string) {
  return useQuery({
    queryKey: ['folder-goals', folderId, status ?? 'all'],
    queryFn: () =>
      api.get<Goal[]>(
        `/goal-folders/${folderId}/goals${status ? `?status=${encodeURIComponent(status)}` : ''}`,
      ),
    enabled: !!folderId,
  })
}

export function useGoal(goalId: string | undefined) {
  return useQuery({
    queryKey: ['goal', goalId],
    queryFn: () => api.get<GoalDetail>(`/goals/${goalId}`),
    enabled: !!goalId,
  })
}

export function useGoalActivity(goalId: string | undefined) {
  return useQuery({
    queryKey: ['goal-activity', goalId],
    queryFn: () => api.get<Activity[]>(`/goals/${goalId}/activity`),
    enabled: !!goalId,
  })
}

export function useGoalProgress(goalId: string | undefined) {
  return useQuery({
    queryKey: ['goal-progress', goalId],
    queryFn: () => api.get<GoalProgress>(`/goals/${goalId}/progress`),
    enabled: !!goalId,
  })
}

export function useTargetTasks(targetId: string | undefined) {
  return useQuery({
    queryKey: ['goal-target-tasks', targetId],
    queryFn: () => api.get<Task[]>(`/targets/${targetId}/tasks`),
    enabled: !!targetId,
  })
}

export function useRunningTimer() {
  return useQuery({
    queryKey: ['timer'],
    queryFn: () => api.get<TimeEntry | null>('/timer/current'),
    refetchInterval: 60_000,
  })
}

export function useTeams(workspaceId: string | undefined) {
  return useQuery({
    queryKey: ['teams', workspaceId],
    queryFn: () => api.get<Team[]>(`/workspaces/${workspaceId}/teams`),
    enabled: !!workspaceId,
  })
}

export function useWhiteboards(workspaceId: string | undefined) {
  return useQuery({
    queryKey: ['whiteboards', workspaceId],
    queryFn: () => api.get<Whiteboard[]>(`/workspaces/${workspaceId}/whiteboards`),
    enabled: !!workspaceId,
  })
}

export function useForms(workspaceId: string | undefined) {
  return useQuery({
    queryKey: ['forms', workspaceId],
    queryFn: () => api.get<FormDef[]>(`/workspaces/${workspaceId}/forms`),
    enabled: !!workspaceId,
  })
}

export function useWorkspaceMembers(workspaceId: string | undefined) {
  return useQuery({
    queryKey: ['workspace-members', workspaceId],
    queryFn: () =>
      api.get<OrgMember[]>(`/workspaces/${workspaceId}/members`),
    enabled: !!workspaceId,
  })
}

export function useGoalOwnerCandidates(workspaceId: string | undefined, enabled = true) {
  return useQuery({
    queryKey: ['goal-owner-candidates', workspaceId],
    queryFn: () =>
      api.get<OrgMember[]>(`/workspaces/${workspaceId}/goal-owner-candidates`),
    enabled: !!workspaceId && enabled,
  })
}

export function useWorkspaceMemberCandidates(workspaceId: string | undefined, enabled = true) {
  return useQuery({
    queryKey: ['workspace-member-candidates', workspaceId],
    queryFn: () =>
      api.get<WorkspaceMemberCandidate[]>(`/workspaces/${workspaceId}/member-candidates`),
    enabled: !!workspaceId && enabled,
  })
}

export function useSpaceMemberCandidates(spaceId: string | undefined, enabled = true) {
  return useQuery({
    queryKey: ['space-member-candidates', spaceId],
    queryFn: () =>
      api.get<WorkspaceMemberCandidate[]>(`/spaces/${spaceId}/member-candidates`),
    enabled: !!spaceId && enabled,
  })
}

export function useProjectMemberCandidates(projectId: string | undefined, enabled = true) {
  return useQuery({
    queryKey: ['project-member-candidates', projectId],
    queryFn: () =>
      api.get<Array<{ user_id: string; in_workspace: boolean; user: WorkspaceMemberCandidate['user'] }>>(
        `/projects/${projectId}/member-candidates`,
      ),
    enabled: !!projectId && enabled,
  })
}

export function useSpaceMembers(spaceId: string | undefined) {
  return useQuery({
    queryKey: ['space-members', spaceId],
    queryFn: () => api.get<OrgMember[]>(`/spaces/${spaceId}/members`),
    enabled: !!spaceId,
  })
}

export function useProjectMembers(projectId: string | undefined) {
  return useQuery({
    queryKey: ['project-members', projectId],
    queryFn: () => api.get<OrgMember[]>(`/projects/${projectId}/members`),
    enabled: !!projectId,
  })
}

export function useOrganizationMembers(orgId: string | undefined) {
  return useQuery({
    queryKey: ['organization-members', orgId],
    queryFn: () => api.get<OrgMember[]>(`/organizations/${orgId}/members`),
    enabled: !!orgId,
  })
}

export function useMemberAccess(
  orgId: string | undefined,
  userId: string | undefined,
  scope: PeoplePanelScope = { level: 'org' },
) {
  return useQuery({
    queryKey: ['member-access', orgId, userId, scope],
    queryFn: () =>
      api.get<MemberAccessDetail>(memberAccessApiPath(orgId!, userId!, scope)),
    enabled: !!orgId && !!userId,
    retry: false,
  })
}

export function useUnreadNotifications() {
  return useQuery({
    queryKey: ['notifications-unread'],
    queryFn: () => api.get<{ count: number }>('/notifications/unread-count'),
  })
}

export function useUserRoles() {
  return useQuery({
    queryKey: ['user-roles'],
    queryFn: () => api.get<UserRoleSummary>('/users/me/roles'),
    staleTime: 15_000,
    refetchOnWindowFocus: true,
  })
}

export function useOrgDashboard(orgId: string | undefined) {
  return useQuery({
    queryKey: ['org-dashboard', orgId],
    queryFn: () => api.get<OrgDashboard>(`/organizations/${orgId}/dashboard`),
    enabled: !!orgId,
    retry: (failureCount, error) =>
      failureCount < 2 && (error instanceof TypeError || (error instanceof ApiError && error.status >= 502)),
  })
}

export function useWorkspaceDashboard(workspaceId: string | undefined) {
  return useQuery({
    queryKey: ['workspace-dashboard', workspaceId],
    queryFn: () => api.get<WorkspaceDashboard>(`/workspaces/${workspaceId}/dashboard`),
    enabled: !!workspaceId,
    refetchInterval: 60_000,
  })
}

export function useSpaceDashboard(spaceId: string | undefined) {
  return useQuery({
    queryKey: ['space-dashboard', spaceId],
    queryFn: () => api.get<SpaceDashboard>(`/spaces/${spaceId}/dashboard`),
    enabled: !!spaceId,
    refetchInterval: 60_000,
  })
}

export function useProjectDashboard(projectId: string | undefined) {
  return useQuery({
    queryKey: ['project-dashboard', projectId],
    queryFn: () => api.get<ProjectDashboard>(`/projects/${projectId}/dashboard`),
    enabled: !!projectId,
    refetchInterval: 60_000,
  })
}

export function useProjectMemberDashboard(projectId: string | undefined) {
  return useQuery({
    queryKey: ['project-member-dashboard', projectId],
    queryFn: () => api.get<ProjectMemberDashboard>(`/projects/${projectId}/member-dashboard`),
    enabled: !!projectId,
    refetchInterval: 60_000,
  })
}

/* ---------------- Analytics ---------------- */

/** Serialize analytics filters into a query-string tail (each key prefixed with &). */
export function analyticsQueryTail(filters: Record<string, string | undefined | null>): string {
  const parts: string[] = []
  for (const [key, value] of Object.entries(filters)) {
    if (value != null && value !== '') parts.push(`${key}=${encodeURIComponent(value)}`)
  }
  return parts.length ? `&${parts.join('&')}` : ''
}

export function useAnalyticsOverview(orgId: string | undefined, tail = '') {
  return useQuery({
    queryKey: ['analytics-overview', orgId, tail],
    queryFn: () => api.get<AnalyticsOverview>(`/analytics/overview?organization_id=${orgId}${tail}`),
    enabled: !!orgId,
    refetchInterval: 60_000,
  })
}

export function useAnalyticsTimeline(orgId: string | undefined, tail = '') {
  return useQuery({
    queryKey: ['analytics-timeline', orgId, tail],
    queryFn: () => api.get<AnalyticsTimeline>(`/analytics/timeline?organization_id=${orgId}${tail}`),
    enabled: !!orgId,
    refetchInterval: 60_000,
  })
}

export function useAnalyticsStatusDistribution(orgId: string | undefined, tail = '') {
  return useQuery({
    queryKey: ['analytics-status', orgId, tail],
    queryFn: () =>
      api.get<AnalyticsStatusDistribution>(
        `/analytics/status-distribution?organization_id=${orgId}${tail}`,
      ),
    enabled: !!orgId,
    refetchInterval: 60_000,
  })
}

export function useAnalyticsUsers(orgId: string | undefined, tail = '') {
  return useQuery({
    queryKey: ['analytics-users', orgId, tail],
    queryFn: () => api.get<PresenceUsersPage>(`/analytics/users?organization_id=${orgId}${tail}`),
    enabled: !!orgId,
    refetchInterval: 60_000,
  })
}

export function useAnalyticsActivityFeed(orgId: string | undefined, tail = '') {
  return useQuery({
    queryKey: ['analytics-activity', orgId, tail],
    queryFn: () =>
      api.get<PresenceActivityItem[]>(`/analytics/activity-feed?organization_id=${orgId}${tail}`),
    enabled: !!orgId,
    refetchInterval: 60_000,
  })
}

export function useAnalyticsTeamActivity(orgId: string | undefined, groupBy: string, tail = '') {
  return useQuery({
    queryKey: ['analytics-team-activity', orgId, groupBy, tail],
    queryFn: () =>
      api.get<TeamActivityGroup>(
        `/analytics/team-activity?organization_id=${orgId}&group_by=${groupBy}${tail}`,
      ),
    enabled: !!orgId,
    refetchInterval: 60_000,
  })
}

export function useAnalyticsUserDetail(orgId: string | undefined, userId: string | null) {
  return useQuery({
    queryKey: ['analytics-user-detail', orgId, userId],
    queryFn: () =>
      api.get<UserPresenceDetail>(`/analytics/users/${userId}?organization_id=${orgId}`),
    enabled: !!orgId && !!userId,
    refetchInterval: 60_000,
  })
}

export function useAnalyticsTrends(orgId: string | undefined, days: number, tail = '') {
  return useQuery({
    queryKey: ['analytics-trends', orgId, days, tail],
    queryFn: () =>
      api.get<AnalyticsTrends>(`/analytics/trends?organization_id=${orgId}&days=${days}${tail}`),
    enabled: !!orgId,
    refetchInterval: 120_000,
  })
}

export function useAnalyticsHeatmap(orgId: string | undefined, days: number, tail = '') {
  return useQuery({
    queryKey: ['analytics-heatmap', orgId, days, tail],
    queryFn: () =>
      api.get<AnalyticsHeatmap>(`/analytics/heatmap?organization_id=${orgId}&days=${days}${tail}`),
    enabled: !!orgId,
    refetchInterval: 120_000,
  })
}

export function useAnalyticsContributionHeatmap(orgId: string | undefined, days: number, tail = '') {
  return useQuery({
    queryKey: ['analytics-contribution-heatmap', orgId, days, tail],
    queryFn: () =>
      api.get<AnalyticsContributionHeatmap>(
        `/analytics/contribution-heatmap?organization_id=${orgId}&days=${days}${tail}`,
      ),
    enabled: !!orgId,
    refetchInterval: 120_000,
  })
}

export function useAnalyticsDevices(orgId: string | undefined, days: number, tail = '') {
  return useQuery({
    queryKey: ['analytics-devices', orgId, days, tail],
    queryFn: () =>
      api.get<DeviceAnalytics>(`/analytics/devices?organization_id=${orgId}&days=${days}${tail}`),
    enabled: !!orgId,
    refetchInterval: 120_000,
  })
}

export function useAnalyticsAlerts(orgId: string | undefined, tail = '') {
  return useQuery({
    queryKey: ['analytics-alerts', orgId, tail],
    queryFn: () => api.get<AnalyticsAlerts>(`/analytics/alerts?organization_id=${orgId}${tail}`),
    enabled: !!orgId,
    refetchInterval: 60_000,
  })
}

/* ---------------- My Analytics (personal) ---------------- */

function useMyAnalyticsUserId() {
  return useAuthStore((s) => s.user?.id)
}

export function useMyAnalyticsOverview() {
  const userId = useMyAnalyticsUserId()
  return useQuery({
    queryKey: ['my-analytics-overview', userId],
    queryFn: () => api.get<MyAnalyticsOverviewResponse>('/my-analytics/overview'),
    enabled: !!userId,
    refetchInterval: 120_000,
  })
}

export function useMyProductivityTrend(period: 'week' | 'month') {
  const userId = useMyAnalyticsUserId()
  return useQuery({
    queryKey: ['my-analytics-productivity', userId, period],
    queryFn: () => api.get<MyProductivityTrend>(`/my-analytics/productivity-trend?period=${period}`),
    enabled: !!userId,
    refetchInterval: 120_000,
  })
}

export function useMyTaskTrends() {
  const userId = useMyAnalyticsUserId()
  return useQuery({
    queryKey: ['my-analytics-task-trends', userId],
    queryFn: () => api.get<MyTaskTrends>('/my-analytics/task-trends'),
    enabled: !!userId,
    refetchInterval: 120_000,
  })
}

export function useMyDeadlinePerformance(days = 90) {
  const userId = useMyAnalyticsUserId()
  return useQuery({
    queryKey: ['my-analytics-deadline', userId, days],
    queryFn: () => api.get<MyDeadlinePerformance>(`/my-analytics/deadline-performance?days=${days}`),
    enabled: !!userId,
    staleTime: 0,
    refetchInterval: 120_000,
  })
}

export function useMyPersonalActivity(limit = 50) {
  const userId = useMyAnalyticsUserId()
  return useQuery({
    queryKey: ['my-analytics-activity', userId, limit],
    queryFn: () => api.get<MyPersonalActivity>(`/my-analytics/activity?limit=${limit}`),
    enabled: !!userId,
    refetchInterval: 60_000,
  })
}

export function useMyWorkPattern(days = 30) {
  const userId = useMyAnalyticsUserId()
  return useQuery({
    queryKey: ['my-analytics-work-pattern', userId, days],
    queryFn: () => api.get<MyWorkPattern>(`/my-analytics/work-pattern?days=${days}`),
    enabled: !!userId,
    refetchInterval: 120_000,
  })
}

export function useMyTimeDistribution(days = 30) {
  const userId = useMyAnalyticsUserId()
  return useQuery({
    queryKey: ['my-analytics-time-distribution', userId, days],
    queryFn: () => api.get<MyTimeDistribution>(`/my-analytics/time-distribution?days=${days}`),
    enabled: !!userId,
    refetchInterval: 120_000,
  })
}

export function useMyProjectContribution(days = 30) {
  const userId = useMyAnalyticsUserId()
  return useQuery({
    queryKey: ['my-analytics-project-contribution', userId, days],
    queryFn: () => api.get<MyProjectContribution>(`/my-analytics/project-contribution?days=${days}`),
    enabled: !!userId,
    refetchInterval: 120_000,
  })
}

export function useMyCollaboration(days = 30) {
  const userId = useMyAnalyticsUserId()
  return useQuery({
    queryKey: ['my-analytics-collaboration', userId, days],
    queryFn: () => api.get<MyCollaboration>(`/my-analytics/collaboration?days=${days}`),
    enabled: !!userId,
    refetchInterval: 120_000,
  })
}

export function useMyPriorityAnalysis(days = 30) {
  const userId = useMyAnalyticsUserId()
  return useQuery({
    queryKey: ['my-analytics-priority', userId, days],
    queryFn: () => api.get<MyPriorityAnalysis>(`/my-analytics/priority-analysis?days=${days}`),
    enabled: !!userId,
    refetchInterval: 120_000,
  })
}

export function useMyBenchmarks(period: 'week' | 'month') {
  const userId = useMyAnalyticsUserId()
  return useQuery({
    queryKey: ['my-analytics-benchmarks', userId, period],
    queryFn: () => api.get<MyPersonalBenchmarks>(`/my-analytics/benchmarks?period=${period}`),
    enabled: !!userId,
    refetchInterval: 120_000,
  })
}
