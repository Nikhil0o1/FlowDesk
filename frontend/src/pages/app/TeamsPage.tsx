import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Check, Plus, Trash2, Users, X } from 'lucide-react'
import { useState } from 'react'
import { useSearchParams } from 'react-router-dom'

import { api, errorMessage } from '../../lib/api'
import { useCurrentContext, useTeams, useWorkspaceMembers } from '../../lib/queries'
import type { Team } from '../../lib/types'
import { cn, formatDate } from '../../lib/utils'
import { useAuthStore } from '../../stores/auth'
import { toast } from '../../stores/toast'
import { Avatar, AvatarStack } from '../../components/ui/Avatar'
import { EmptyState } from '../../components/ui/EmptyState'
import { Modal } from '../../components/ui/Modal'
import { CenteredSpinner } from '../../components/ui/Spinner'

const TEAM_COLORS = ['#8C5BFF', '#4CB782', '#5B9FF0', '#F2994A', '#E667A8', '#26B5CE', '#E5484D']

export default function TeamsPage() {
  const { workspace } = useCurrentContext()
  const teams = useTeams(workspace?.id)
  const [params, setParams] = useSearchParams()

  const tab = params.get('tab') === 'people' ? 'people' : 'teams'
  const selectedTeam = teams.data?.find((t) => t.id === params.get('team')) ?? null
  const createOpen = params.get('new') === '1'

  const closeOverlays = () => {
    params.delete('new')
    params.delete('team')
    setParams(params, { replace: true })
  }

  if (teams.isLoading) return <CenteredSpinner />

  return (
    <div className="mx-auto max-w-5xl px-8 py-7">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-fg">{tab === 'people' ? 'All People' : 'All Teams'}</h1>
          <p className="mt-0.5 text-sm text-fg-secondary">
            {tab === 'people'
              ? `Everyone in ${workspace?.name ?? 'this workspace'}`
              : 'Group people to assign and mention them as a unit.'}
          </p>
        </div>
        <button
          className="btn-primary"
          onClick={() => {
            params.set('new', '1')
            setParams(params, { replace: true })
          }}
        >
          <Plus size={15} /> Create Team
        </button>
      </div>

      <div className="mt-6">{tab === 'people' ? <PeopleList /> : <TeamsGrid teams={teams.data ?? []} />}</div>

      <CreateTeamModal open={createOpen} onClose={closeOverlays} />
      {selectedTeam && <ManageTeamModal team={selectedTeam} onClose={closeOverlays} />}
    </div>
  )
}

function TeamsGrid({ teams }: { teams: Team[] }) {
  const [, setParams] = useSearchParams()
  if (teams.length === 0) {
    return (
      <EmptyState
        icon={Users}
        title="No teams yet"
        description="Use Teams to easily create groups of people you can assign to tasks and mention in comments."
      />
    )
  }
  return (
    <div className="grid grid-cols-3 gap-4 max-lg:grid-cols-2 max-md:grid-cols-1">
      {teams.map((team) => (
        <button
          key={team.id}
          onClick={() => setParams({ team: team.id }, { replace: true })}
          className="rounded-2xl border border-ink-700 bg-ink-850/60 p-5 text-left transition-colors hover:border-ink-600"
        >
          <div className="flex items-start gap-3">
            <span
              className="flex h-10 w-10 items-center justify-center rounded-xl text-base font-bold text-white"
              style={{ backgroundColor: team.color }}
            >
              {team.name[0]?.toUpperCase()}
            </span>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-semibold text-fg">{team.name}</p>
              <p className="mt-0.5 line-clamp-2 text-xs text-fg-secondary">
                {team.description || 'No description'}
              </p>
            </div>
          </div>
          <div className="mt-4 flex items-center justify-between">
            <AvatarStack users={team.members} size={24} max={5} />
            <span className="text-[11px] text-fg-muted">
              {team.members.length} member{team.members.length === 1 ? '' : 's'}
            </span>
          </div>
        </button>
      ))}
    </div>
  )
}

function PeopleList() {
  const { workspace } = useCurrentContext()
  const members = useWorkspaceMembers(workspace?.id)

  if (members.isLoading) return <CenteredSpinner />
  return (
    <div className="overflow-hidden rounded-xl border border-ink-700">
      {(members.data ?? []).map((member) => (
        <div key={member.id} className="flex items-center gap-3 border-b border-ink-700/60 bg-ink-900 px-4 py-3 last:border-b-0">
          <Avatar
            name={member.user?.full_name || member.user?.email || '?'}
            src={member.user?.avatar_url}
            size={34}
            userId={member.user_id}
            showPresence
          />
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium text-fg">{member.user?.full_name || member.user?.email}</p>
            <p className="truncate text-xs text-fg-muted">{member.user?.email}</p>
          </div>
          <span className="text-[11px] text-fg-muted">joined {formatDate(member.created_at)}</span>
          <span
            className={cn(
              'rounded px-2 py-0.5 text-[10px] font-semibold uppercase',
              member.role === 'admin' ? 'bg-brand-soft text-brand' : 'bg-ink-750 text-fg-secondary',
            )}
          >
            {member.role}
          </span>
        </div>
      ))}
    </div>
  )
}

function CreateTeamModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { workspace } = useCurrentContext()
  const queryClient = useQueryClient()
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [color, setColor] = useState(TEAM_COLORS[0])

  const create = useMutation({
    mutationFn: () =>
      api.post<Team>(`/workspaces/${workspace!.id}/teams`, {
        name: name.trim(),
        description: description.trim() || null,
        color,
      }),
    onSuccess: () => {
      toast.success('Team created')
      void queryClient.invalidateQueries({ queryKey: ['teams', workspace?.id] })
      setName('')
      setDescription('')
      onClose()
    },
    onError: (err) => toast.error(errorMessage(err)),
  })

  return (
    <Modal open={open} onClose={onClose} title="Create Team" width="max-w-md">
      <p className="mb-4 text-sm text-fg-secondary">
        Use Teams to easily create groups of people you can assign to tasks, mention in comments, or
        add as watchers.
      </p>
      <div className="space-y-3">
        <div>
          <label className="mb-1.5 block text-xs font-medium text-fg-secondary">Icon & name</label>
          <div className="flex items-center gap-2.5">
            <span
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-sm font-bold text-white"
              style={{ backgroundColor: color }}
            >
              {(name[0] || 'T').toUpperCase()}
            </span>
            <input
              className="input-dark"
              placeholder="Team name…"
              value={name}
              onChange={(e) => setName(e.target.value)}
              autoFocus
            />
          </div>
        </div>
        <div className="flex gap-2">
          {TEAM_COLORS.map((c) => (
            <button
              key={c}
              onClick={() => setColor(c)}
              className={cn('h-6 w-6 rounded-lg transition-transform', color === c && 'scale-110 ring-2 ring-white/60')}
              style={{ backgroundColor: c }}
            />
          ))}
        </div>
        <div>
          <label className="mb-1.5 block text-xs font-medium text-fg-secondary">Description (optional)</label>
          <textarea
            rows={3}
            className="input-dark resize-none"
            placeholder="Add Team description, information, and wiki"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
          />
        </div>
        <div className="flex justify-end">
          <button className="btn-primary" disabled={!name.trim() || create.isPending} onClick={() => create.mutate()}>
            Create Team
          </button>
        </div>
      </div>
    </Modal>
  )
}

function ManageTeamModal({ team, onClose }: { team: Team; onClose: () => void }) {
  const { workspace } = useCurrentContext()
  const queryClient = useQueryClient()
  const user = useAuthStore((s) => s.user)
  const members = useWorkspaceMembers(workspace?.id)
  const [name, setName] = useState(team.name)
  const [description, setDescription] = useState(team.description ?? '')
  const [confirmDelete, setConfirmDelete] = useState(false)

  const refresh = () => void queryClient.invalidateQueries({ queryKey: ['teams', workspace?.id] })
  const isManager = team.created_by === user?.id || workspace?.my_role === 'admin' || workspace?.my_role === 'owner'

  const save = async () => {
    try {
      await api.patch(`/teams/${team.id}`, { name: name.trim(), description: description.trim() || null })
      toast.success('Team updated')
      refresh()
    } catch (err) {
      toast.error(errorMessage(err))
    }
  }

  const toggleMember = async (userId: string, isMember: boolean) => {
    try {
      if (isMember) await api.delete(`/teams/${team.id}/members/${userId}`)
      else await api.post(`/teams/${team.id}/members`, { user_ids: [userId] })
      refresh()
    } catch (err) {
      toast.error(errorMessage(err))
    }
  }

  const remove = async () => {
    try {
      await api.delete(`/teams/${team.id}`)
      toast.success('Team deleted')
      refresh()
      onClose()
    } catch (err) {
      toast.error(errorMessage(err))
    }
  }

  const memberIds = new Set(team.members.map((m) => m.id))

  return (
    <Modal open onClose={onClose} title={team.name} width="max-w-lg">
      <div className="space-y-4">
        {isManager && (
          <div className="space-y-2.5">
            <input className="input-dark" value={name} onChange={(e) => setName(e.target.value)} />
            <textarea
              rows={2}
              className="input-dark resize-none"
              placeholder="Description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
            <div className="flex justify-end">
              <button className="btn-secondary !py-1.5 text-xs" onClick={save} disabled={!name.trim()}>
                Save changes
              </button>
            </div>
          </div>
        )}

        <div>
          <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-fg-muted">
            Members ({team.members.length})
          </p>
          <div className="max-h-64 space-y-0.5 overflow-y-auto">
            {(members.data ?? []).map((member) => {
              const isMember = memberIds.has(member.user_id)
              const canToggle = isManager || member.user_id === user?.id
              return (
                <div key={member.user_id} className="flex items-center gap-2.5 rounded-lg px-2 py-1.5 hover:bg-ink-800">
                  <Avatar
                    name={member.user?.full_name || member.user?.email || '?'}
                    src={member.user?.avatar_url}
                    size={26}
                  />
                  <span className="min-w-0 flex-1 truncate text-sm text-fg">
                    {member.user?.full_name || member.user?.email}
                    {member.user_id === user?.id && <span className="text-fg-muted"> (you)</span>}
                  </span>
                  {canToggle ? (
                    <button
                      onClick={() => toggleMember(member.user_id, isMember)}
                      className={cn(
                        'flex h-5 w-5 items-center justify-center rounded border transition-colors',
                        isMember ? 'border-brand bg-brand text-white' : 'border-ink-600 hover:border-fg-muted',
                      )}
                      title={isMember ? 'Remove from team' : 'Add to team'}
                    >
                      {isMember ? <Check size={12} /> : <Plus size={11} className="text-fg-muted" />}
                    </button>
                  ) : (
                    isMember && <Check size={14} className="text-brand" />
                  )}
                </div>
              )
            })}
          </div>
        </div>

        {isManager && (
          <div className="border-t border-ink-700 pt-3">
            {confirmDelete ? (
              <div className="flex items-center justify-between text-sm">
                <span className="text-fg-secondary">Delete this team?</span>
                <span className="flex gap-3">
                  <button className="font-semibold text-red-400 hover:text-red-300" onClick={remove}>
                    Delete
                  </button>
                  <button className="text-fg-muted hover:text-fg" onClick={() => setConfirmDelete(false)}>
                    <X size={14} />
                  </button>
                </span>
              </div>
            ) : (
              <button
                className="flex items-center gap-1.5 text-xs text-fg-muted transition-colors hover:text-red-400"
                onClick={() => setConfirmDelete(true)}
              >
                <Trash2 size={13} /> Delete team
              </button>
            )}
          </div>
        )}
      </div>
    </Modal>
  )
}
