import type { Project, Space } from '../../lib/types'
import {
  formatWorkspaceAdminTopRoleLabel,
  type WorkspaceAdminTopRole,
} from './inviteScopes'
import { InviteProjectMultiSelect } from './InviteMultiSelect'

const SPACE_ADMIN_TOP_ROLES: readonly WorkspaceAdminTopRole[] = ['admin', 'member', 'viewer']
const PROJECT_ADMIN_TOP_ROLES: readonly WorkspaceAdminTopRole[] = ['admin', 'member', 'viewer']

function ChoiceButtons<T extends string>({
  label,
  value,
  options,
  onChange,
  formatLabel,
}: {
  label: string
  value: T
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

export function SpaceAdminInviteFields({
  topRole,
  onTopRoleChange,
  spaceName,
  spaces,
  projects,
  projectsLoading,
  selectedProjectIds,
  onSelectedProjectIdsChange,
}: {
  topRole: WorkspaceAdminTopRole
  onTopRoleChange: (role: WorkspaceAdminTopRole) => void
  spaceName: string
  spaces: Space[]
  projects: Project[]
  projectsLoading: boolean
  selectedProjectIds: string[]
  onSelectedProjectIdsChange: (ids: string[]) => void
}) {
  return (
    <div className="space-y-4">
      <p className="rounded-lg border border-ink-700 bg-ink-800/50 px-3 py-2 text-xs text-fg-secondary">
        Invites are scoped to <span className="font-medium text-fg">{spaceName}</span>.
      </p>
      <ChoiceButtons
        label="Role"
        value={topRole}
        options={SPACE_ADMIN_TOP_ROLES}
        onChange={onTopRoleChange}
        formatLabel={(role) =>
          role === 'admin' ? 'Project Admin' : formatWorkspaceAdminTopRoleLabel(role)
        }
      />
      {projectsLoading ? (
        <p className="text-xs text-fg-muted">Loading projects…</p>
      ) : (
        <>
          <InviteProjectMultiSelect
            label="Projects"
            spaces={spaces}
            projects={projects}
            selectedIds={selectedProjectIds}
            onChange={onSelectedProjectIdsChange}
            placeholder="No projects in this space yet."
          />
          {topRole === 'admin' && (
            <p className="text-[11px] text-fg-muted">
              Project admins can manage members and settings for the selected projects.
            </p>
          )}
          {topRole === 'viewer' && (
            <p className="text-[11px] text-fg-muted">
              Viewers can only view tasks in the projects you select.
            </p>
          )}
        </>
      )}
    </div>
  )
}

export function ProjectAdminInviteFields({
  topRole,
  onTopRoleChange,
  projectName,
  spaces,
  projects,
  projectsLoading,
  selectedProjectIds,
  onSelectedProjectIdsChange,
}: {
  topRole: WorkspaceAdminTopRole
  onTopRoleChange: (role: WorkspaceAdminTopRole) => void
  projectName: string
  spaces: Space[]
  projects: Project[]
  projectsLoading: boolean
  selectedProjectIds: string[]
  onSelectedProjectIdsChange: (ids: string[]) => void
}) {
  return (
    <div className="space-y-4">
      <p className="rounded-lg border border-ink-700 bg-ink-800/50 px-3 py-2 text-xs text-fg-secondary">
        Invites are scoped to projects you administer (starting with{' '}
        <span className="font-medium text-fg">{projectName}</span>).
      </p>
      <ChoiceButtons
        label="Role"
        value={topRole}
        options={PROJECT_ADMIN_TOP_ROLES}
        onChange={onTopRoleChange}
        formatLabel={(role) =>
          role === 'admin' ? 'Project Admin' : formatWorkspaceAdminTopRoleLabel(role)
        }
      />
      {projectsLoading ? (
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
          />
          {topRole === 'admin' && (
            <p className="text-[11px] text-fg-muted">
              Project admins can manage members and settings for the selected projects.
            </p>
          )}
          {topRole === 'viewer' && (
            <p className="text-[11px] text-fg-muted">
              Viewers can only view tasks in the projects you select.
            </p>
          )}
        </>
      )}
    </div>
  )
}
