import ProjectAdminDashboard from '../dashboard/ProjectAdminDashboard'
import ProjectMemberDashboard from '../dashboard/ProjectMemberDashboard'

const NO_SCOPES: { id: string; label: string; meta?: string }[] = []
const noopScope = () => {}

/** Project "Overview" view tab: the same live, role-appropriate dashboard the
 * home Dashboard page shows for this project (admins get the full project
 * dashboard, members/viewers the actor-scoped one). */
export function ProjectOverview({ projectId, isAdmin }: { projectId: string; isAdmin: boolean }) {
  if (isAdmin) {
    return (
      <ProjectAdminDashboard
        projectId={projectId}
        scopeOptions={NO_SCOPES}
        scopeId={projectId}
        onScopeChange={noopScope}
      />
    )
  }
  return (
    <ProjectMemberDashboard
      projectId={projectId}
      scopeOptions={NO_SCOPES}
      scopeId={projectId}
      onScopeChange={noopScope}
    />
  )
}
