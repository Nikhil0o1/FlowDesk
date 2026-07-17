import { AddPeopleChoiceModal } from './AddPeopleChoiceModal'
import { AddProjectPeopleModal } from './AddProjectPeopleModal'
import { AddSpacePeopleModal } from './AddSpacePeopleModal'
import { AddWorkspacePeopleModal } from './AddWorkspacePeopleModal'
import { useCurrentContext, useUserRoles } from '../../lib/queries'
import { useUIStore } from '../../stores/ui'

/** Global invite choice + existing-people modals (home rail, sidebar, All People). */
export function PeopleInviteOverlays() {
  const { org } = useCurrentContext()
  const { data: roles } = useUserRoles()
  const inviteFlowKind = useUIStore((s) => s.inviteFlowKind)
  const peopleInviteChoiceOpen = useUIStore((s) => s.peopleInviteChoiceOpen)
  const setPeopleInviteChoiceOpen = useUIStore((s) => s.setPeopleInviteChoiceOpen)
  const existingPeopleOpen = useUIStore((s) => s.existingPeopleOpen)
  const setExistingPeopleOpen = useUIStore((s) => s.setExistingPeopleOpen)
  const setInviteOpen = useUIStore((s) => s.setInviteOpen)
  const inviteWorkspaceId = useUIStore((s) => s.inviteWorkspaceId)
  const inviteSpaceId = useUIStore((s) => s.inviteSpaceId)
  const inviteProjectId = useUIStore((s) => s.inviteProjectId)

  if (!org?.id || !inviteFlowKind) return null

  const spaceMeta = roles?.space_roles.find((s) => s.space_id === inviteSpaceId)
  const projectMeta = roles?.project_roles.find((p) => p.project_id === inviteProjectId)

  return (
    <>
      <AddPeopleChoiceModal
        open={peopleInviteChoiceOpen}
        onClose={() => setPeopleInviteChoiceOpen(false)}
        scope={inviteFlowKind}
        onNewPeople={() => {
          setPeopleInviteChoiceOpen(false)
          setInviteOpen(true)
        }}
        onExistingPeople={() => {
          setPeopleInviteChoiceOpen(false)
          setExistingPeopleOpen(true)
        }}
      />
      {inviteFlowKind === 'workspace' && inviteWorkspaceId && (
        <AddWorkspacePeopleModal
          open={existingPeopleOpen}
          onClose={() => setExistingPeopleOpen(false)}
          workspaceId={inviteWorkspaceId}
          orgId={org.id}
        />
      )}
      {inviteFlowKind === 'space' && inviteSpaceId && inviteWorkspaceId && (
        <AddSpacePeopleModal
          open={existingPeopleOpen}
          onClose={() => setExistingPeopleOpen(false)}
          spaceId={inviteSpaceId}
          workspaceId={inviteWorkspaceId}
          orgId={org.id}
          spaceName={spaceMeta?.space_name ?? 'this space'}
        />
      )}
      {inviteFlowKind === 'project' && inviteProjectId && inviteWorkspaceId && (
        <AddProjectPeopleModal
          open={existingPeopleOpen}
          onClose={() => setExistingPeopleOpen(false)}
          projectId={inviteProjectId}
          workspaceId={inviteWorkspaceId}
          orgId={org.id}
          projectName={projectMeta?.project_name ?? 'this project'}
        />
      )}
    </>
  )
}
