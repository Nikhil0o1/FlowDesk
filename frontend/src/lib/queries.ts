import { useQuery } from '@tanstack/react-query'
import { useEffect } from 'react'

import { api } from './api'
import type {
  Channel,
  CustomStatus,
  FormDef,
  Organization,
  Page,
  Project,
  Space,
  Sprint,
  Task,
  TaskList,
  Team,
  TimeEntry,
  Whiteboard,
  Workspace,
} from './types'
import { useWorkspaceStore } from '../stores/workspace'

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
    queryFn: () => api.get<Page<Task>>(`/projects/${projectId}/tasks?page_size=500${params}`),
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
      api.get<{ id: string; user_id: string; role: string; created_at: string; user: { id: string; email: string; full_name: string; avatar_url: string | null } | null }[]>(
        `/workspaces/${workspaceId}/members`,
      ),
    enabled: !!workspaceId,
  })
}

export function useUnreadNotifications() {
  return useQuery({
    queryKey: ['notifications-unread'],
    queryFn: () => api.get<{ count: number }>('/notifications/unread-count'),
  })
}
