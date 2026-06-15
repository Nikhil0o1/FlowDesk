import { useMutation, useQueryClient } from '@tanstack/react-query'
import { ChevronDown, Presentation, Search, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'

import { api, errorMessage } from '../../lib/api'
import { useCurrentContext, useWhiteboards } from '../../lib/queries'
import type { Whiteboard } from '../../lib/types'
import { timeAgo } from '../../lib/utils'
import { useRealtime } from '../../lib/ws'
import { useAuthStore } from '../../stores/auth'
import { toast } from '../../stores/toast'
import { Avatar } from '../../components/ui/Avatar'
import { EmptyState } from '../../components/ui/EmptyState'
import { Modal } from '../../components/ui/Modal'
import { CenteredSpinner } from '../../components/ui/Spinner'

export default function WhiteboardsPage() {
  const { workspace } = useCurrentContext()
  const boards = useWhiteboards(workspace?.id)
  const user = useAuthStore((s) => s.user)
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [params, setParams] = useSearchParams()
  const [q, setQ] = useState('')

  const mineOnly = params.get('mine') === '1'
  const createOpen = params.get('new') === '1'

  useRealtime(
    ['whiteboard.created', 'whiteboard.updated', 'whiteboard.deleted'],
    () => void queryClient.invalidateQueries({ queryKey: ['whiteboards', workspace?.id] }),
    [workspace?.id],
  )

  const visible = (boards.data ?? []).filter(
    (b) =>
      (!mineOnly || b.created_by === user?.id) &&
      (!q.trim() || b.name.toLowerCase().includes(q.trim().toLowerCase())),
  )

  const remove = async (board: Whiteboard) => {
    if (!window.confirm(`Delete whiteboard "${board.name}"?`)) return
    try {
      await api.delete(`/whiteboards/${board.id}`)
      toast.success('Whiteboard deleted')
      void queryClient.invalidateQueries({ queryKey: ['whiteboards', workspace?.id] })
    } catch (err) {
      toast.error(errorMessage(err))
    }
  }

  if (boards.isLoading) return <CenteredSpinner />

  return (
    <div className="mx-auto max-w-6xl px-8 py-7">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold text-fg">{mineOnly ? 'My Whiteboards' : 'All Whiteboards'}</h1>
        <button
          className="btn-primary"
          onClick={() => {
            params.set('new', '1')
            setParams(params, { replace: true })
          }}
        >
          New Whiteboard <ChevronDown size={14} />
        </button>
      </div>

      <div className="relative mt-5 max-w-xs">
        <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-fg-muted" />
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search"
          className="input-dark !pl-9"
        />
      </div>

      {visible.length === 0 ? (
        <EmptyState
          icon={Presentation}
          title={q ? 'No matching whiteboards' : 'No whiteboards yet'}
          description="Sketch ideas, plan flows and collaborate visually."
        />
      ) : (
        <div className="mt-6 grid grid-cols-4 gap-4 max-xl:grid-cols-3 max-lg:grid-cols-2 max-md:grid-cols-1">
          {visible.map((board) => (
            <div
              key={board.id}
              className="group cursor-pointer overflow-hidden rounded-2xl border border-ink-700 bg-ink-850/60 transition-colors hover:border-ink-600"
              onClick={() => navigate(`/app/whiteboards/${board.id}`)}
            >
              {/* Preview area */}
              <div
                className="relative flex h-40 items-center justify-center border-b border-ink-700/60 bg-ink-900"
                style={{
                  backgroundImage: 'radial-gradient(circle, rgba(255,255,255,0.05) 1px, transparent 1px)',
                  backgroundSize: '16px 16px',
                }}
              >
                <Presentation size={30} className="text-ink-600" />
                {board.element_count > 0 && (
                  <span className="absolute bottom-2 right-2 rounded bg-ink-750 px-1.5 py-0.5 text-[10px] text-fg-secondary">
                    {board.element_count} element{board.element_count === 1 ? '' : 's'}
                  </span>
                )}
                {(board.created_by === user?.id ||
                  workspace?.my_role === 'admin' ||
                  workspace?.my_role === 'owner') && (
                  <button
                    className="absolute right-2 top-2 hidden rounded-lg bg-ink-800 p-1.5 text-fg-muted hover:text-red-400 group-hover:block"
                    onClick={(e) => {
                      e.stopPropagation()
                      void remove(board)
                    }}
                    title="Delete"
                  >
                    <Trash2 size={13} />
                  </button>
                )}
              </div>
              <div className="flex items-center gap-2.5 px-4 py-3">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-fg">{board.name}</p>
                  <p className="text-[11px] text-fg-muted">Edited {timeAgo(board.updated_at)}</p>
                </div>
                <Avatar
                  name={board.creator?.full_name || board.creator?.email || '?'}
                  src={board.creator?.avatar_url}
                  size={26}
                />
              </div>
            </div>
          ))}
        </div>
      )}

      <CreateWhiteboardModal
        open={createOpen}
        onClose={() => {
          params.delete('new')
          setParams(params, { replace: true })
        }}
      />
    </div>
  )
}

function CreateWhiteboardModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { workspace } = useCurrentContext()
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  const [name, setName] = useState('')

  const create = useMutation({
    mutationFn: () => api.post<Whiteboard>(`/workspaces/${workspace!.id}/whiteboards`, { name: name.trim() }),
    onSuccess: (board) => {
      void queryClient.invalidateQueries({ queryKey: ['whiteboards', workspace?.id] })
      setName('')
      onClose()
      navigate(`/app/whiteboards/${board.id}`)
    },
    onError: (err) => toast.error(errorMessage(err)),
  })

  return (
    <Modal open={open} onClose={onClose} title="New Whiteboard" width="max-w-md">
      <div className="space-y-3">
        <input
          autoFocus
          className="input-dark"
          placeholder="Whiteboard name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && name.trim() && create.mutate()}
        />
        <button className="btn-primary w-full" disabled={!name.trim() || create.isPending} onClick={() => create.mutate()}>
          Create whiteboard
        </button>
      </div>
    </Modal>
  )
}
