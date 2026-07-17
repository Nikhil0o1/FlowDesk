import { useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'

import { useWorkspaceMemberCandidates } from '../../lib/queries'
import { AssignExistingPersonModal } from './AssignExistingPersonModal'
import { ExistingPeopleCandidateTable } from './peopleCandidateUi'
import { Modal } from '../ui/Modal'
import type { WorkspaceMemberCandidate } from '../../lib/types'

export function AddWorkspacePeopleModal({
  open,
  onClose,
  workspaceId,
  orgId,
}: {
  open: boolean
  onClose: () => void
  workspaceId: string
  orgId: string
}) {
  const queryClient = useQueryClient()
  const candidates = useWorkspaceMemberCandidates(open ? workspaceId : undefined, open)
  const [assignTarget, setAssignTarget] = useState<WorkspaceMemberCandidate | null>(null)

  const candidateList = candidates.data ?? []

  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: ['organization-members', orgId] })
    void queryClient.invalidateQueries({ queryKey: ['workspace-members', workspaceId] })
    void queryClient.invalidateQueries({ queryKey: ['workspace-member-candidates', workspaceId] })
    void queryClient.invalidateQueries({ queryKey: ['workspaces'] })
    void queryClient.invalidateQueries({ queryKey: ['spaces', workspaceId] })
    void queryClient.invalidateQueries({ queryKey: ['projects', workspaceId] })
  }

  return (
    <>
      <Modal open={open} onClose={onClose} title="Add existing people" width="max-w-3xl">
        <p className="mb-4 text-sm text-fg-secondary">
          Organization members you can assign to spaces and projects in this workspace. Org owners
          and admins are excluded.
        </p>
        <ExistingPeopleCandidateTable
          candidates={candidateList}
          workspaceId={workspaceId}
          isLoading={candidates.isLoading}
          emptyDetail="Every organization member is an org owner or admin, or there are no org members yet."
          onManage={setAssignTarget}
        />
      </Modal>
      <AssignExistingPersonModal
        open={!!assignTarget}
        onClose={() => setAssignTarget(null)}
        candidate={assignTarget}
        workspaceId={workspaceId}
        orgId={orgId}
        onAssigned={() => {
          setAssignTarget(null)
          refresh()
        }}
      />
    </>
  )
}
