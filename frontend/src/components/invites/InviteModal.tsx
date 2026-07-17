import { useNavigate } from 'react-router-dom'
import { cn } from '../../lib/utils'
import {
  formatSpaceInviteRoleLabel,
  inviteRolesForScope,
  isSpaceInviteProjectRole,
  type InviteScope,
} from './inviteScopes'
import { InviteTargetSelect } from './InviteTargetSelect'
import { WorkspaceAdminInviteFields } from './WorkspaceAdminInviteFields'
import { ProjectAdminInviteFields, SpaceAdminInviteFields } from './ScopedAdminInviteFields'
import { useInviteForm } from './useInviteForm'
import { Modal } from '../ui/Modal'

export function InviteModal({
  open,
  onClose,
  defaultScope = 'workspace',
  defaultWorkspaceId = '',
  defaultProjectId = '',
}: {
  open: boolean
  onClose: () => void
  defaultScope?: InviteScope
  defaultWorkspaceId?: string
  defaultProjectId?: string
}) {
  const navigate = useNavigate()
  const form = useInviteForm({
    open,
    onClose,
    defaultScope,
    defaultWorkspaceId,
    defaultProjectId,
  })

  const roleOptions = inviteRolesForScope(form.scope)

  const handleCreateProject = (workspaceId: string) => {
    onClose()
    navigate(`/app/workspaces/${workspaceId}?create=project`)
  }

  return (
    <Modal open={open} onClose={onClose} title="Invite people" width="max-w-lg">
      <div className="space-y-4">
        <div>
          <label className="mb-1.5 block text-xs font-medium text-fg-secondary">Email address</label>
          <input
            type="email"
            className={cn('input-dark', form.emailError && 'border-red-500/50')}
            placeholder="teammate@company.com"
            value={form.email}
            onChange={(e) => form.setEmail(e.target.value)}
            onBlur={form.onEmailBlur}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && form.canSubmit) {
                e.preventDefault()
                form.send()
              }
            }}
            aria-invalid={form.emailError ? true : undefined}
            autoFocus
          />
          {form.emailError && <p className="mt-1.5 text-xs text-red-400">{form.emailError}</p>}
        </div>

        {form.isWorkspaceAdminFlow ? (
          <WorkspaceAdminInviteFields
            topRole={form.topRole}
            onTopRoleChange={form.setTopRole}
            adminKind={form.adminKind}
            onAdminKindChange={form.setAdminKind}
            workspaces={form.inviteWorkspaces}
            workspacesLoading={form.workspacesLoading}
            workspaceId={form.workspaceId}
            onWorkspaceChange={form.setWorkspaceId}
            spaces={form.inviteSpaces}
            spacesLoading={form.spacesLoading}
            selectedSpaceIds={form.selectedSpaceIds}
            onSelectedSpaceIdsChange={form.setSelectedSpaceIds}
            projects={form.inviteProjects}
            projectsLoading={form.projectsLoading}
            selectedProjectIds={form.selectedProjectIds}
            onSelectedProjectIdsChange={form.setSelectedProjectIds}
            onCreateProject={handleCreateProject}
          />
        ) : form.isSpaceAdminFlow ? (
          <SpaceAdminInviteFields
            topRole={form.topRole}
            onTopRoleChange={form.setTopRole}
            spaceName={form.spaceName}
            spaces={form.inviteSpaces}
            projects={form.inviteProjects}
            projectsLoading={form.projectsLoading}
            selectedProjectIds={form.selectedProjectIds}
            onSelectedProjectIdsChange={form.setSelectedProjectIds}
          />
        ) : form.isProjectAdminFlow ? (
          <ProjectAdminInviteFields
            topRole={form.topRole}
            onTopRoleChange={(role) => form.setTopRole(role)}
            projectName={form.projectName}
            spaces={form.inviteSpaces}
            projects={form.inviteProjects}
            projectsLoading={form.projectsLoading}
            selectedProjectIds={form.selectedProjectIds}
            onSelectedProjectIdsChange={form.setSelectedProjectIds}
          />
        ) : (
          <>
        <div>
          <label className="mb-1.5 block text-xs font-medium text-fg-secondary">Invite to</label>
          <div className="flex gap-2 flex-wrap">
            {form.isOrgAdminOrOwner && (
              <ScopeButton current={form.scope} value="organization" onSelect={form.setScope}>
                Organization
              </ScopeButton>
            )}
            {form.canWorkspaceInvite && (
              <ScopeButton current={form.scope} value="workspace" onSelect={form.setScope}>
                Workspace
              </ScopeButton>
            )}
            {form.canSpaceInvite && (
              <ScopeButton current={form.scope} value="space" onSelect={form.setScope}>
                Space
              </ScopeButton>
            )}
            {form.canProjectInvite && (
              <ScopeButton current={form.scope} value="project" onSelect={form.setScope}>
                Project
              </ScopeButton>
            )}
          </div>
        </div>

        {form.scope === 'space' && (
          <div>
            <label className="mb-1.5 block text-xs font-medium text-fg-secondary">Role</label>
            <select className="input-dark" value={form.role} onChange={(e) => form.setRole(e.target.value)}>
              {roleOptions.map((r) => (
                <option key={r} value={r}>
                  {formatInviteRoleLabel(form.scope, r)}
                </option>
              ))}
            </select>
            <p className="mt-1 text-[11px] text-fg-muted">
              {form.role === 'space_admin'
                ? 'Space admins manage everything inside the selected spaces.'
                : form.role === 'project_viewer'
                  ? 'Pick one or more projects below for view-only access.'
                  : 'Pick one or more projects below for project access.'}
            </p>
          </div>
        )}

        <InviteTargetSelect
          scope={form.scope}
          role={form.role}
          workspaces={form.inviteWorkspaces}
          workspacesLoading={form.workspacesLoading}
          workspaceId={form.workspaceId}
          onWorkspaceChange={form.setWorkspaceId}
          selectedWorkspaceIds={form.selectedWorkspaceIds}
          onSelectedWorkspaceIdsChange={form.setSelectedWorkspaceIds}
          spaces={form.inviteSpaces}
          spacesLoading={form.spacesLoading}
          selectedSpaceIds={form.selectedSpaceIds}
          onSelectedSpaceIdsChange={form.setSelectedSpaceIds}
          projects={form.inviteProjects}
          projectsLoading={form.projectsLoading}
          selectedProjectIds={form.selectedProjectIds}
          onSelectedProjectIdsChange={form.setSelectedProjectIds}
          onCreateProject={handleCreateProject}
        />

        {form.scope !== 'space' && (
          <div>
            <label className="mb-1.5 block text-xs font-medium text-fg-secondary">Role</label>
            <select className="input-dark" value={form.role} onChange={(e) => form.setRole(e.target.value)}>
              {roleOptions.map((r) => (
                <option key={r} value={r}>
                  {formatInviteRoleLabel(form.scope, r)}
                </option>
              ))}
            </select>
          </div>
        )}
          </>
        )}

        <p className="text-xs text-fg-muted">
          New users get an onboarding email to activate their account. Existing users get an accept
          link — no password reset needed. Multiple targets are combined into one email.
        </p>

        <button className="btn-primary w-full" disabled={!form.canSubmit} onClick={form.send}>
          {form.sending ? 'Sending…' : 'Send invitation'}
        </button>
      </div>
    </Modal>
  )
}

function formatInviteRoleLabel(scope: InviteScope, role: string): string {
  if (scope === 'space') return formatSpaceInviteRoleLabel(role)
  if (scope === 'project') {
    if (role === 'admin') return 'Project Admin'
    if (role === 'member') return 'Project Member'
    if (role === 'viewer') return 'Project Viewer'
  }
  return role[0].toUpperCase() + role.slice(1)
}

function ScopeButton({
  current,
  value,
  onSelect,
  children,
}: {
  current: InviteScope
  value: InviteScope
  onSelect: (s: InviteScope) => void
  children: React.ReactNode
}) {
  return (
    <button
      onClick={() => onSelect(value)}
      className={`flex-1 rounded-lg border px-3 py-2 text-xs font-medium transition-colors ${
        current === value
          ? 'border-brand bg-brand-soft text-fg'
          : 'border-ink-700 bg-ink-800 text-fg-secondary hover:bg-ink-750'
      }`}
    >
      {children}
    </button>
  )
}
