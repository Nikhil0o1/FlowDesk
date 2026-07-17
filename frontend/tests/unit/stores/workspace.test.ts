import { beforeEach, describe, expect, it } from 'vitest'

import { useWorkspaceStore } from '@/stores/workspace'

describe('useWorkspaceStore', () => {
  beforeEach(() => {
    useWorkspaceStore.setState({ currentOrgId: null, currentWorkspaceId: null })
  })

  it('starts with no selection', () => {
    const state = useWorkspaceStore.getState()
    expect(state.currentOrgId).toBeNull()
    expect(state.currentWorkspaceId).toBeNull()
  })

  it('setOrg updates the current organization', () => {
    useWorkspaceStore.getState().setOrg('org-42')
    expect(useWorkspaceStore.getState().currentOrgId).toBe('org-42')
  })

  it('setWorkspace updates the current workspace', () => {
    useWorkspaceStore.getState().setWorkspace('ws-7')
    expect(useWorkspaceStore.getState().currentWorkspaceId).toBe('ws-7')
  })

  it('allows clearing selections', () => {
    useWorkspaceStore.getState().setOrg('org-1')
    useWorkspaceStore.getState().setWorkspace('ws-1')
    useWorkspaceStore.getState().setOrg(null)
    useWorkspaceStore.getState().setWorkspace(null)
    const state = useWorkspaceStore.getState()
    expect(state.currentOrgId).toBeNull()
    expect(state.currentWorkspaceId).toBeNull()
  })
})
