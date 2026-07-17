import type { Project, Space, Workspace } from '../../lib/types'
import {
  formatSpaceInviteRoleLabel,
  formatWorkspaceAdminTopRoleLabel,
  type WorkspaceAdminAdminKind,
  type WorkspaceAdminTopRole,
  WORKSPACE_ADMIN_ADMIN_KINDS,
  WORKSPACE_ADMIN_TOP_ROLES,
  workspaceLabel,
} from './inviteScopes'
import { InviteProjectMultiSelect, InviteSpaceMultiSelect } from './InviteMultiSelect'

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

function ChoiceButtons<T extends string>({
  label,
  value,
  options,
  onChange,
  formatLabel,
}: {
  label: string
  value: T | ''
  options: readonly T[]
  onChange: (value: T) => void
  formatLabel: (value: T) => string
}) {
  return (
    <div>
      <label className="mb-1.5 block text-xs font-medium text-fg-secondary">{label}</label>
      <div className="flex flex-wrap gap-2">
        {options.map((opt) => (
          <button
            key={opt}
            type="button"
            onClick={() => onChange(opt)}
            className={`rounded-lg border px-3 py-2 text-xs font-medium transition-colors ${
              value === opt
                ? 'border-brand bg-brand-soft text-fg'
                : 'border-ink-700 bg-ink-800 text-fg-secondary hover:bg-ink-750'
            }`}
          >
            {formatLabel(opt)}
          </button>
        ))}
      </div>
    </div>
  )
}

export function WorkspaceAdminInviteFields({
  topRole,
  onTopRoleChange,
  adminKind,
  onAdminKindChange,
  workspaces,
  workspacesLoading,
  workspaceId,
  onWorkspaceChange,
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
  topRole: WorkspaceAdminTopRole
  onTopRoleChange: (role: WorkspaceAdminTopRole) => void
  adminKind: WorkspaceAdminAdminKind | ''
  onAdminKindChange: (kind: WorkspaceAdminAdminKind) => void
  workspaces: Workspace[]
  workspacesLoading: boolean
  workspaceId: string
  onWorkspaceChange: (id: string) => void
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
  const workspaceOptions = workspaces.map((ws) => ({ id: ws.id, label: workspaceLabel(ws) }))
  const showWorkspacePicker = workspaces.length > 1

  return (
    <div className="space-y-4">
      <ChoiceButtons
        label="Role"
        value={topRole}
        options={WORKSPACE_ADMIN_TOP_ROLES}
        onChange={onTopRoleChange}
        formatLabel={formatWorkspaceAdminTopRoleLabel}
      />

      {topRole === 'admin' && (
        <>
          <ChoiceButtons
            label="Admin access"
            value={adminKind}
            options={WORKSPACE_ADMIN_ADMIN_KINDS}
            onChange={onAdminKindChange}
            formatLabel={formatSpaceInviteRoleLabel}
          />

          {adminKind === 'space_admin' && (
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
                  />
                ))}
              {workspaceId &&
                (spacesLoading ? (
                  <p className="text-xs text-fg-muted">Loading spaces…</p>
                ) : (
                  <InviteSpaceMultiSelect
                    label="Spaces"
                    spaces={spaces}
                    selectedIds={selectedSpaceIds}
                    onChange={onSelectedSpaceIdsChange}
                    placeholder="No spaces in this workspace yet."
                  />
                ))}
            </>
          )}

          {adminKind === 'project_admin' && (
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
                  />
                ))}
              {workspaceId &&
                (projectsLoading ? (
                  <p className="text-xs text-fg-muted">Loading projects…</p>
                ) : (
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
                ))}
            </>
          )}
        </>
      )}

      {(topRole === 'member' || topRole === 'viewer') && (
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
              />
            ))}
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
                  placeholder="No projects in this workspace yet."
                  onCreateProject={onCreateProject}
                  workspaceId={workspaceId}
                />
                {topRole === 'viewer' && (
                  <p className="text-[11px] text-fg-muted">
                    Viewers can only view tasks in the projects you select — no editing.
                  </p>
                )}
              </>
            ))}
        </>
      )}
    </div>
  )
}
