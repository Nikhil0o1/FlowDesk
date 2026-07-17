import { useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'

import { useSpaceMemberCandidates } from '../../lib/queries'
import type { WorkspaceMemberCandidate } from '../../lib/types'
import { AssignExistingPersonModal } from './AssignExistingPersonModal'
import { ExistingPeopleCandidateTable } from './peopleCandidateUi'
import { Modal } from '../ui/Modal'

export function AddSpacePeopleModal({
  open,
  onClose,
  spaceId,
  workspaceId,
  orgId,
  spaceName,
}: {
  open: boolean
  onClose: () => void
  spaceId: string
  workspaceId: string
  orgId: string
  spaceName: string
}) {
  const queryClient = useQueryClient()
  const candidates = useSpaceMemberCandidates(open ? spaceId : undefined, open)
  const [assignTarget, setAssignTarget] = useState<WorkspaceMemberCandidate | null>(null)

  const candidateList = candidates.data ?? []

  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: ['organization-members', orgId] })
    void queryClient.invalidateQueries({ queryKey: ['workspace-members', workspaceId] })
    void queryClient.invalidateQueries({ queryKey: ['space-member-candidates', spaceId] })
    void queryClient.invalidateQueries({ queryKey: ['workspace-member-candidates', workspaceId] })
    void queryClient.invalidateQueries({ queryKey: ['space-members', spaceId] })
    void queryClient.invalidateQueries({ queryKey: ['projects', workspaceId] })
  }

  return (
    <>
      <Modal open={open} onClose={onClose} title="Add existing people" width="max-w-3xl">
        <p className="mb-4 text-sm text-fg-secondary">
          Organization members you can assign to spaces and projects in{' '}
          <span className="font-medium text-fg">{spaceName}</span>. Org owners and admins are
          excluded.
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
        assignScope="space"
        scopeSpaceId={spaceId}
        onAssigned={() => {
          setAssignTarget(null)
          refresh()
        }}
      />
    </>
  )
}
