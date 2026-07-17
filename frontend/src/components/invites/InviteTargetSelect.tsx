import type { Project, Space, Workspace } from '../../lib/types'
import {
  InviteProjectMultiSelect,
  InviteSpaceMultiSelect,
  InviteWorkspaceMultiSelect,
} from './InviteMultiSelect'
import { isSpaceInviteProjectRole, type InviteScope } from './inviteScopes'

function FieldSelect({
  label,
  value,
  onChange,
  options,
  placeholder,
}: {
  label: string
  value: string
  onChange: (id: string) => void
  options: { id: string; label: string }[]
  placeholder?: string
}) {
  if (options.length === 0) {
    return (
      <div>
        <label className="mb-1.5 block text-xs font-medium text-fg-secondary">{label}</label>
        <p className="text-xs text-fg-muted">{placeholder ?? `No ${label.toLowerCase()} available.`}</p>
      </div>
    )
  }

  return (
    <div>
      <label className="mb-1.5 block text-xs font-medium text-fg-secondary">{label}</label>
      <select className="input-dark" value={value} onChange={(e) => onChange(e.target.value)}>
        <option value="">Select {label.toLowerCase()}…</option>
        {options.map((opt) => (
          <option key={opt.id} value={opt.id}>
            {opt.label}
          </option>
        ))}
      </select>
    </div>
  )
}

export function InviteTargetSelect({
  scope,
  role,
  workspaces,
  workspacesLoading,
  workspaceId,
  onWorkspaceChange,
  selectedWorkspaceIds,
  onSelectedWorkspaceIdsChange,
  spaces,
  spacesLoading,
  selectedSpaceIds,
  onSelectedSpaceIdsChange,
  projects,
  projectsLoading,
  selectedProjectIds,
  onSelectedProjectIdsChange,
  onCreateProject,
}: {
  scope: InviteScope
  role: string
  workspaces: Workspace[]
  workspacesLoading: boolean
  workspaceId: string
  onWorkspaceChange: (id: string) => void
  selectedWorkspaceIds: string[]
  onSelectedWorkspaceIdsChange: (ids: string[]) => void
  spaces: Space[]
  spacesLoading: boolean
  selectedSpaceIds: string[]
  onSelectedSpaceIdsChange: (ids: string[]) => void
  projects: Project[]
  projectsLoading: boolean
  selectedProjectIds: string[]
  onSelectedProjectIdsChange: (ids: string[]) => void
  onCreateProject?: (workspaceId: string) => void
}) {
  if (scope === 'organization') return null

  const showWorkspacePicker = workspaces.length > 1
  const workspaceOptions = workspaces.map((ws) => ({
    id: ws.id,
    label: ws.is_archived ? `${ws.name} (archived)` : ws.name,
  }))

  if (scope === 'workspace') {
    if (workspacesLoading) return <p className="text-xs text-fg-muted">Loading workspaces…</p>
    return (
      <InviteWorkspaceMultiSelect
        label="Workspaces"
        workspaces={workspaces}
        selectedIds={selectedWorkspaceIds}
        onChange={onSelectedWorkspaceIdsChange}
        placeholder="You don't have permission to invite anyone to a workspace yet."
      />
    )
  }

  const workspaceContext = (
    <>
      {showWorkspacePicker &&
        (workspacesLoading ? (
          <p className="text-xs text-fg-muted">Loading workspaces…</p>
        ) : (
          <FieldSelect
            label="Workspace"
            value={workspaceId}
            onChange={onWorkspaceChange}
            options={workspaceOptions}
            placeholder="No workspaces available."
          />
        ))}
    </>
  )

  if (scope === 'space') {
    return (
      <div className="space-y-4">
        {workspaceContext}
        {workspaceId &&
          (role === 'space_admin' ? (
            spacesLoading ? (
              <p className="text-xs text-fg-muted">Loading spaces…</p>
            ) : (
              <InviteSpaceMultiSelect
                label="Spaces"
                spaces={spaces}
                selectedIds={selectedSpaceIds}
                onChange={onSelectedSpaceIdsChange}
                placeholder="No spaces in this workspace yet. Create a space first."
              />
            )
          ) : isSpaceInviteProjectRole(role) ? (
            projectsLoading ? (
              <p className="text-xs text-fg-muted">Loading projects…</p>
            ) : (
              <>
                <InviteProjectMultiSelect
                  label="Projects"
                  spaces={spaces}
                  projects={projects}
                  selectedIds={selectedProjectIds}
                  onChange={onSelectedProjectIdsChange}
                  placeholder="No projects in this workspace yet."
                  onCreateProject={onCreateProject}
                  workspaceId={workspaceId}
                />
                {role === 'project_viewer' && (
                  <p className="text-[11px] text-fg-muted">
                    Viewers can only view tasks in the projects you select — no editing.
                  </p>
                )}
              </>
            )
          ) : null)}
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {workspaceContext}
      {workspaceId &&
        (projectsLoading ? (
          <p className="text-xs text-fg-muted">Loading projects…</p>
        ) : (
          <>
            <InviteProjectMultiSelect
              label="Projects"
              spaces={spaces}
              projects={projects}
              selectedIds={selectedProjectIds}
              onChange={onSelectedProjectIdsChange}
              placeholder="No projects available."
              onCreateProject={onCreateProject}
              workspaceId={workspaceId}
            />
            {role === 'viewer' && (
              <p className="text-[11px] text-fg-muted">
                Viewers can only view tasks in the projects you select — no editing.
              </p>
            )}
          </>
        ))}
    </div>
  )
}
