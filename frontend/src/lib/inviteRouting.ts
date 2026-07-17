import type { QueryClient } from '@tanstack/react-query'

import { useWorkspaceStore } from '../stores/workspace'
import type { InviteContext } from './types'

/** App route to open after the user joins via an invite. */
export function inviteLandingPath(invite: InviteContext): string {
  if (invite.scope === 'project' && invite.project_id) {
    return `/app/projects/${invite.project_id}`
  }
  if (invite.scope === 'space' && invite.workspace_id) {
    return `/app/workspaces/${invite.workspace_id}`
  }
  if (invite.scope === 'workspace' && invite.workspace_id) {
    return `/app/workspaces/${invite.workspace_id}`
  }
  return '/app/dashboard'
}

/** Persist org/workspace selection so the shell opens in the right context. */
export function syncInviteWorkspaceStore(invite: InviteContext): void {
  const { setOrg, setWorkspace } = useWorkspaceStore.getState()
  setOrg(invite.organization_id)
  if (invite.workspace_id) {
    setWorkspace(invite.workspace_id)
  }
}

/** Refresh cached membership lists after accept/activate. */
export function invalidateInviteQueries(invite: InviteContext, queryClient: QueryClient): void {
  void queryClient.invalidateQueries({ queryKey: ['organizations'] })
  void queryClient.invalidateQueries({ queryKey: ['workspaces', invite.organization_id] })

  if (invite.workspace_id) {
    void queryClient.invalidateQueries({ queryKey: ['workspace', invite.workspace_id] })
    void queryClient.invalidateQueries({ queryKey: ['workspace-members', invite.workspace_id] })
    void queryClient.invalidateQueries({ queryKey: ['projects', invite.workspace_id] })
    void queryClient.invalidateQueries({ queryKey: ['spaces', invite.workspace_id] })
  }

  if (invite.space_id) {
    void queryClient.invalidateQueries({ queryKey: ['space-members', invite.space_id] })
  }

  if (invite.project_id) {
    void queryClient.invalidateQueries({ queryKey: ['project', invite.project_id] })
  }
}

/** Apply invite target to client state after a successful join. */
export function applyInviteContext(invite: InviteContext, queryClient: QueryClient): void {
  syncInviteWorkspaceStore(invite)
  invalidateInviteQueries(invite, queryClient)
}
