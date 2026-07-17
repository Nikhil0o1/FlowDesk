import { describe, expect, it, vi } from 'vitest'
import { QueryClient } from '@tanstack/react-query'

import { useWorkspaceStore } from '@/stores/workspace'
import {
  applyInviteContext,
  invalidateInviteQueries,
  inviteLandingPath,
  syncInviteWorkspaceStore,
} from '@/lib/inviteRouting'
import type { InviteContext } from '@/lib/types'

function invite(partial: Partial<InviteContext>): InviteContext {
  return {
    scope: 'workspace',
    organization_id: 'org-1',
    workspace_id: 'ws-1',
    project_id: null,
    ...partial,
  }
}

describe('inviteLandingPath', () => {
  it('routes project invites to the project page', () => {
    expect(
      inviteLandingPath(
        invite({ scope: 'project', project_id: 'proj-99', workspace_id: 'ws-1' }),
      ),
    ).toBe('/app/projects/proj-99')
  })

  it('routes workspace invites to the workspace page', () => {
    expect(inviteLandingPath(invite({ scope: 'workspace', workspace_id: 'ws-42' }))).toBe(
      '/app/workspaces/ws-42',
    )
  })

  it('falls back to dashboard for organization scope', () => {
    expect(
      inviteLandingPath(invite({ scope: 'organization', workspace_id: null, project_id: null })),
    ).toBe('/app/dashboard')
  })
})

describe('syncInviteWorkspaceStore', () => {
  it('sets org and workspace in the workspace store', () => {
    const setOrg = vi.fn()
    const setWorkspace = vi.fn()
    vi.spyOn(useWorkspaceStore, 'getState').mockReturnValue({
      setOrg,
      setWorkspace,
    } as ReturnType<typeof useWorkspaceStore.getState>)

    syncInviteWorkspaceStore(invite({ workspace_id: 'ws-9' }))
    expect(setOrg).toHaveBeenCalledWith('org-1')
    expect(setWorkspace).toHaveBeenCalledWith('ws-9')
  })
})

describe('invalidateInviteQueries', () => {
  it('invalidates membership caches for workspace and project invites', () => {
    const queryClient = new QueryClient()
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries')

    invalidateInviteQueries(
      invite({ scope: 'project', workspace_id: 'ws-1', project_id: 'proj-1' }),
      queryClient,
    )

    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['organizations'] })
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['workspace', 'ws-1'] })
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['project', 'proj-1'] })
  })
})

describe('applyInviteContext', () => {
  it('syncs store and invalidates queries', () => {
    const queryClient = new QueryClient()
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries')
    const setOrg = vi.fn()
    const setWorkspace = vi.fn()
    vi.spyOn(useWorkspaceStore, 'getState').mockReturnValue({
      setOrg,
      setWorkspace,
    } as ReturnType<typeof useWorkspaceStore.getState>)

    applyInviteContext(invite({ workspace_id: 'ws-1' }), queryClient)
    expect(setOrg).toHaveBeenCalled()
    expect(invalidate).toHaveBeenCalled()
  })
})
