import { UserPlus } from 'lucide-react'

import { formatRoleLabel, formatScopedRole } from '../../lib/roleLabels'
import type {
  ProjectMembershipBrief,
  SpaceMembershipBrief,
  WorkspaceMemberCandidate,
  WorkspaceMembershipBrief,
} from '../../lib/types'
import { cn } from '../../lib/utils'
import { Avatar } from '../ui/Avatar'

export type RoleBadgeItem = {
  key: string
  label: string
  detail?: string
  chipClass: string
}

/** Workspace names the person belongs to, current workspace first. */
export function workspaceNames(
  workspaces: WorkspaceMembershipBrief[],
  currentWorkspaceId: string,
): string[] {
  return [...workspaces]
    .sort((a, b) => {
      if (a.workspace_id === currentWorkspaceId) return -1
      if (b.workspace_id === currentWorkspaceId) return 1
      return a.workspace_name.localeCompare(b.workspace_name)
    })
    .map((w) => w.workspace_name)
}

export function collectRoleBadges(
  orgRole: string,
  workspaces: WorkspaceMembershipBrief[],
  spaces: SpaceMembershipBrief[],
  projects: ProjectMembershipBrief[],
  currentWorkspaceId: string,
): RoleBadgeItem[] {
  const badges: RoleBadgeItem[] = []

  // Show a chip for every workspace the person belongs to, current one first, so a
  // role held in another workspace (e.g. admin elsewhere) is never hidden.
  const orderedWorkspaces = [...workspaces].sort((a, b) => {
    if (a.workspace_id === currentWorkspaceId) return -1
    if (b.workspace_id === currentWorkspaceId) return 1
    return a.workspace_name.localeCompare(b.workspace_name)
  })
  for (const ws of orderedWorkspaces) {
    badges.push({
      key: `ws-${ws.workspace_id}`,
      label: formatScopedRole('workspace', ws.role),
      detail: ws.workspace_id === currentWorkspaceId ? undefined : ws.workspace_name,
      chipClass:
        ws.role === 'admin'
          ? 'bg-indigo-500/15 text-indigo-300'
          : 'bg-ink-750 text-fg-secondary',
    })
  }

  for (const space of spaces) {
    badges.push({
      key: `space-${space.space_id}`,
      label: formatScopedRole('space', space.role),
      detail: space.space_name,
      chipClass: 'bg-cyan-500/15 text-cyan-300',
    })
  }

  for (const project of projects) {
    badges.push({
      key: `project-${project.project_id}`,
      label: formatScopedRole('project', project.role),
      detail: project.project_name,
      chipClass: 'bg-emerald-500/15 text-emerald-300',
    })
  }

  if (badges.length > 0) return badges

  // No workspace/space/project membership anywhere — fall back to the org-level role.
  return [
    {
      key: 'org',
      label: formatRoleLabel(orgRole),
      chipClass: 'bg-ink-750 text-fg-secondary',
    },
  ]
}

export function CandidateRoleChips({ items }: { items: RoleBadgeItem[] }) {
  if (items.length === 0) {
    return <span className="text-xs text-fg-muted">No roles yet</span>
  }

  return (
    <div className="flex flex-wrap gap-1">
      {items.map((item) => (
        <span
          key={item.key}
          title={item.detail ? `${item.label} · ${item.detail}` : item.label}
          className={cn(
            'inline-flex max-w-full items-center gap-1 rounded-md px-2 py-0.5 text-[11px] font-medium leading-snug',
            item.chipClass,
          )}
        >
          <span className="shrink-0">{item.label}</span>
          {item.detail && (
            <>
              <span className="shrink-0 opacity-50">·</span>
              <span className="truncate">{item.detail}</span>
            </>
          )}
        </span>
      ))}
    </div>
  )
}

export function ExistingPeopleCandidateTable({
  candidates,
  workspaceId,
  isLoading,
  emptyDetail,
  onManage,
}: {
  candidates: WorkspaceMemberCandidate[]
  workspaceId: string
  isLoading: boolean
  emptyDetail: string
  onManage: (candidate: WorkspaceMemberCandidate) => void
}) {
  return (
    <>
      <div className="overflow-hidden rounded-xl border border-ink-700">
        <div className="grid grid-cols-[minmax(0,1.4fr)_minmax(0,1.2fr)_minmax(0,0.8fr)_auto] gap-3 border-b border-ink-700 bg-ink-800/80 px-4 py-2 text-[10px] font-semibold uppercase tracking-wider text-fg-muted max-md:hidden">
          <span>Person</span>
          <span>Role</span>
          <span>Workspace</span>
          <span className="text-right">Action</span>
        </div>
        <div className="max-h-80 overflow-y-auto">
          {candidates.map((member) => {
            const name = member.user?.full_name || member.user?.email || 'Unknown'
            const roleBadges = collectRoleBadges(
              member.org_role,
              member.workspaces,
              member.spaces ?? [],
              member.projects ?? [],
              workspaceId,
            )
            const memberWorkspaces = workspaceNames(member.workspaces, workspaceId)
            return (
              <div
                key={member.user_id}
                className="grid grid-cols-1 items-start gap-3 border-b border-ink-700/60 px-4 py-3 last:border-b-0 max-md:gap-2 md:grid-cols-[minmax(0,1.4fr)_minmax(0,1.2fr)_minmax(0,0.8fr)_auto]"
              >
                <div className="flex min-w-0 items-center gap-2.5">
                  <Avatar
                    name={name}
                    src={member.user?.avatar_url}
                    color={member.user?.avatar_color}
                    size={32}
                  />
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-medium text-fg">{name}</span>
                    {member.user?.email && (
                      <span className="block truncate text-xs text-fg-muted">{member.user.email}</span>
                    )}
                  </span>
                </div>
                <div className="min-w-0 md:contents">
                  <div className="min-w-0 max-md:pl-10">
                    <span className="mb-1 block text-[11px] font-medium text-fg-muted md:hidden">
                      Role
                    </span>
                    <CandidateRoleChips items={roleBadges} />
                  </div>
                  <div className="min-w-0 max-md:pl-10 md:pt-0.5">
                    <span className="mb-1 block text-[11px] font-medium text-fg-muted md:hidden">
                      Workspace
                    </span>
                    {memberWorkspaces.length === 0 ? (
                      <span className="text-xs text-fg-muted">Not in this workspace</span>
                    ) : (
                      <div className="flex flex-wrap gap-1">
                        {memberWorkspaces.map((ws) => (
                          <span
                            key={ws}
                            title={ws}
                            className="inline-flex max-w-full items-center rounded-md bg-ink-750 px-2 py-0.5 text-[11px] font-medium leading-snug text-fg-secondary"
                          >
                            <span className="truncate">{ws}</span>
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
                <div className="flex justify-end max-md:pl-10 md:pt-0.5">
                  <button
                    type="button"
                    className="shrink-0 rounded-lg border border-ink-700 px-2.5 py-1 text-xs font-medium text-fg-secondary transition-colors hover:border-brand hover:text-brand"
                    onClick={() => onManage(member)}
                  >
                    Manage
                  </button>
                </div>
              </div>
            )
          })}
        </div>
      </div>
      {isLoading && (
        <p className="mt-3 px-1 text-xs text-fg-muted">Loading organization members…</p>
      )}
      {!isLoading && candidates.length === 0 && (
        <div className="mt-2 flex flex-col items-center gap-2 px-2 py-8 text-center">
          <UserPlus size={24} className="text-fg-muted" />
          <p className="text-sm text-fg-secondary">No one available to assign</p>
          <p className="text-xs text-fg-muted">{emptyDetail}</p>
        </div>
      )}
    </>
  )
}
