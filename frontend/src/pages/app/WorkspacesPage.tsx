import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Archive, Briefcase, Plus, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'

import { api, errorMessage } from '../../lib/api'
import { useCurrentContext } from '../../lib/queries'
import type { Workspace } from '../../lib/types'
import { formatDate } from '../../lib/utils'
import { toast } from '../../stores/toast'
import { useWorkspaceStore } from '../../stores/workspace'
import { EmptyState } from '../../components/ui/EmptyState'
import { Modal } from '../../components/ui/Modal'
import { CenteredSpinner } from '../../components/ui/Spinner'

const COLORS = ['#8C5BFF', '#E5484D', '#F2994A', '#4CB782', '#5B9FF0', '#B07BE0', '#E667A8', '#26B5CE']

export default function WorkspacesPage() {
  const { org, workspaces, isLoading } = useCurrentContext()
  const setWorkspace = useWorkspaceStore((s) => s.setWorkspace)
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [params] = useSearchParams()
  const [createOpen, setCreateOpen] = useState(params.get('new') === '1')
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [color, setColor] = useState(COLORS[0])

  const isOwner = org?.my_role === 'owner'

  const create = useMutation({
    mutationFn: () =>
      api.post<Workspace>(`/organizations/${org!.id}/workspaces`, {
        name: name.trim(),
        description: description.trim() || null,
        color,
      }),
    onSuccess: (ws) => {
      toast.success('Workspace created')
      void queryClient.invalidateQueries({ queryKey: ['workspaces'] })
      setCreateOpen(false)
      setName('')
      setDescription('')
      setWorkspace(ws.id)
      navigate(`/app/workspaces/${ws.id}`)
    },
    onError: (err) => toast.error(errorMessage(err)),
  })

  const archive = async (ws: Workspace) => {
    try {
      await api.post(`/workspaces/${ws.id}/${ws.is_archived ? 'unarchive' : 'archive'}`)
      void queryClient.invalidateQueries({ queryKey: ['workspaces'] })
      toast.success(ws.is_archived ? 'Workspace restored' : 'Workspace archived')
    } catch (err) {
      toast.error(errorMessage(err))
    }
  }

  const remove = async (ws: Workspace) => {
    if (!window.confirm(`Delete workspace "${ws.name}"? This cannot be undone from the UI.`)) return
    try {
      await api.delete(`/workspaces/${ws.id}`)
      void queryClient.invalidateQueries({ queryKey: ['workspaces'] })
      toast.success('Workspace deleted')
    } catch (err) {
      toast.error(errorMessage(err))
    }
  }

  if (isLoading) return <CenteredSpinner />

  return (
    <div className="mx-auto max-w-5xl px-6 py-7">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-fg">Workspaces</h1>
          <p className="mt-0.5 text-sm text-fg-secondary">
            {org?.name} · your role: {org?.my_role ?? 'member'}
          </p>
        </div>
        {isOwner && (
          <button className="btn-primary" onClick={() => setCreateOpen(true)}>
            <Plus size={15} /> New workspace
          </button>
        )}
      </div>

      {workspaces.length === 0 ? (
        <EmptyState
          icon={Briefcase}
          title="No workspaces"
          description={isOwner ? 'Create your first workspace to organize your teams.' : 'You have not been added to any workspace yet.'}
        />
      ) : (
        <div className="mt-6 grid grid-cols-2 gap-4 max-md:grid-cols-1">
          {workspaces.map((ws) => (
            <div
              key={ws.id}
              className="group cursor-pointer rounded-xl border border-ink-700 bg-ink-850 p-5 transition-colors hover:border-ink-600"
              onClick={() => {
                setWorkspace(ws.id)
                navigate(`/app/workspaces/${ws.id}`)
              }}
            >
              <div className="flex items-start gap-3">
                <span
                  className="flex h-10 w-10 items-center justify-center rounded-xl text-base font-bold text-white"
                  style={{ backgroundColor: ws.color }}
                >
                  {ws.name[0].toUpperCase()}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="flex items-center gap-2 truncate text-sm font-semibold text-fg">
                    {ws.name}
                    {ws.is_archived && (
                      <span className="rounded bg-ink-700 px-1.5 py-0.5 text-[10px] text-fg-muted">Archived</span>
                    )}
                  </p>
                  <p className="mt-0.5 line-clamp-2 text-xs text-fg-secondary">{ws.description || 'No description'}</p>
                  <p className="mt-1.5 text-[11px] text-fg-muted">
                    Created {formatDate(ws.created_at)} · role: {ws.my_role ?? '—'}
                  </p>
                </div>
                {isOwner && (
                  <div className="flex gap-1 opacity-0 transition-opacity group-hover:opacity-100" onClick={(e) => e.stopPropagation()}>
                    <button className="btn-ghost !p-1.5" title={ws.is_archived ? 'Restore' : 'Archive'} onClick={() => archive(ws)}>
                      <Archive size={14} />
                    </button>
                    <button className="btn-ghost !p-1.5 hover:!text-red-400" title="Delete" onClick={() => remove(ws)}>
                      <Trash2 size={14} />
                    </button>
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      <Modal open={createOpen} onClose={() => setCreateOpen(false)} title="Create workspace" width="max-w-md">
        <div className="space-y-3">
          <input className="input-dark" placeholder="Workspace name" value={name} onChange={(e) => setName(e.target.value)} autoFocus />
          <textarea rows={2} className="input-dark resize-none" placeholder="Description (optional)" value={description} onChange={(e) => setDescription(e.target.value)} />
          <div className="flex gap-2">
            {COLORS.map((c) => (
              <button
                key={c}
                onClick={() => setColor(c)}
                className={`h-7 w-7 rounded-lg transition-transform ${color === c ? 'scale-110 ring-2 ring-white/60' : ''}`}
                style={{ backgroundColor: c }}
              />
            ))}
          </div>
          <button className="btn-primary w-full" disabled={!name.trim() || create.isPending} onClick={() => create.mutate()}>
            {create.isPending ? 'Creating…' : 'Create workspace'}
          </button>
        </div>
      </Modal>
    </div>
  )
}
