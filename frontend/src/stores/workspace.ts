import { create } from 'zustand'
import { persist } from 'zustand/middleware'

interface WorkspaceState {
  currentOrgId: string | null
  currentWorkspaceId: string | null
  setOrg: (id: string | null) => void
  setWorkspace: (id: string | null) => void
}

export const useWorkspaceStore = create<WorkspaceState>()(
  persist(
    (set) => ({
      currentOrgId: null,
      currentWorkspaceId: null,
      setOrg: (currentOrgId) => set({ currentOrgId }),
      setWorkspace: (currentWorkspaceId) => set({ currentWorkspaceId }),
    }),
    { name: 'flowdesk-workspace' },
  ),
)
