export const PEOPLE_TAB = 'people'
export const WORKSPACE_FILTER_PARAM = 'workspace'
export const SPACE_FILTER_PARAM = 'space'
export const PROJECT_FILTER_PARAM = 'project'

export type PeoplePageScope = {
  workspaceId?: string | null
  spaceId?: string | null
  projectId?: string | null
}

export type PeoplePanelScope =
  | { level: 'org' }
  | { level: 'workspace'; workspaceId: string }
  | { level: 'space'; spaceId: string }
  | { level: 'project'; projectId: string }

/** All People tab with optional scope filters for admin dashboards. */
export function peoplePageUrl(scope?: string | null | PeoplePageScope): string {
  const params = new URLSearchParams({ tab: PEOPLE_TAB })
  if (typeof scope === 'string') {
    if (scope) params.set(WORKSPACE_FILTER_PARAM, scope)
  } else if (scope) {
    if (scope.workspaceId) params.set(WORKSPACE_FILTER_PARAM, scope.workspaceId)
    if (scope.spaceId) params.set(SPACE_FILTER_PARAM, scope.spaceId)
    if (scope.projectId) params.set(PROJECT_FILTER_PARAM, scope.projectId)
  }
  return `/app/teams?${params.toString()}`
}

/** Panel/API scope from All People URL filters (dashboard member stat links). */
export function resolvePeoplePanelScope(params: URLSearchParams): PeoplePanelScope {
  const projectId = params.get(PROJECT_FILTER_PARAM)
  if (projectId) return { level: 'project', projectId }
  const spaceId = params.get(SPACE_FILTER_PARAM)
  if (spaceId) return { level: 'space', spaceId }
  const workspaceId = params.get(WORKSPACE_FILTER_PARAM)
  if (workspaceId) return { level: 'workspace', workspaceId }
  return { level: 'org' }
}

/** Scoped member-access routes use the same admin checks as member list endpoints. */
export function memberAccessApiPath(
  orgId: string,
  userId: string,
  scope: PeoplePanelScope,
): string {
  if (scope.level === 'project') {
    return `/projects/${scope.projectId}/members/${userId}/access`
  }
  if (scope.level === 'space') {
    return `/spaces/${scope.spaceId}/members/${userId}/access`
  }
  if (scope.level === 'workspace') {
    return `/workspaces/${scope.workspaceId}/members/${userId}/access`
  }
  return `/organizations/${orgId}/members/${userId}/access`
}
