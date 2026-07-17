import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Check, Plus, Trash2 } from 'lucide-react'
import { useState } from 'react'

import { api, errorMessage } from '../../lib/api'
import { useStatuses } from '../../lib/queries'
import type { CustomStatus } from '../../lib/types'
import { cn } from '../../lib/utils'
import { toast } from '../../stores/toast'
import { Modal } from '../ui/Modal'
import { Dropdown } from '../ui/Dropdown'
import { ENTITY_COLORS } from '../ui/ColorIconPicker'

type Category = CustomStatus['category']

const CATEGORIES: { key: Category; label: string }[] = [
  { key: 'todo', label: 'Not started' },
  { key: 'in_progress', label: 'Active' },
  { key: 'done', label: 'Done' },
  { key: 'cancelled', label: 'Closed' },
]

/** Project-level task-status editor: statuses grouped by category, full CRUD. */
export function StatusEditorModal({
  open,
  onClose,
  projectId,
  canManage,
}: {
  open: boolean
  onClose: () => void
  projectId: string
  canManage: boolean
}) {
  const queryClient = useQueryClient()
  const statuses = useStatuses(open ? projectId : undefined)
  const onError = (err: unknown) => toast.error(errorMessage(err))
  const refresh = () => void queryClient.invalidateQueries({ queryKey: ['statuses', projectId] })

  const [addingTo, setAddingTo] = useState<Category | null>(null)
  const [newName, setNewName] = useState('')

  const createStatus = useMutation({
    mutationFn: (v: { name: string; category: Category; color: string }) =>
      api.post(`/projects/${projectId}/statuses`, v),
    onSuccess: () => {
      setAddingTo(null)
      setNewName('')
      refresh()
    },
    onError,
  })
  const patchStatus = useMutation({
    mutationFn: (v: { id: string; changes: Partial<Pick<CustomStatus, 'name' | 'color' | 'category'>> }) =>
      api.patch(`/statuses/${v.id}`, v.changes),
    onSuccess: refresh,
    onError,
  })
  const deleteStatus = useMutation({
    mutationFn: (id: string) => api.delete(`/statuses/${id}`),
    onSuccess: refresh,
    onError,
  })

  const all = statuses.data ?? []
  const defaultColor = ENTITY_COLORS[0]

  return (
    <Modal open={open} onClose={onClose} title="Task statuses" width="max-w-lg">
      <div className="space-y-4">
        {CATEGORIES.map((cat) => {
          const group = all.filter((s) => s.category === cat.key).sort((a, b) => a.position - b.position)
          return (
            <div key={cat.key}>
              <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wider text-fg-muted">{cat.label}</p>
              <div className="space-y-1">
                {group.map((s) => (
                  <StatusRow
                    key={s.id}
                    status={s}
                    canManage={canManage}
                    onRecolor={(color) => patchStatus.mutate({ id: s.id, changes: { color } })}
                    onRename={(name) => patchStatus.mutate({ id: s.id, changes: { name } })}
                    onDelete={() => deleteStatus.mutate(s.id)}
                  />
                ))}
                {canManage &&
                  (addingTo === cat.key ? (
                    <div className="flex items-center gap-2 px-1">
                      <input
                        autoFocus
                        className="input-dark !py-1 min-w-0 flex-1 text-sm"
                        placeholder="Status name"
                        value={newName}
                        onChange={(e) => setNewName(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' && newName.trim())
                            createStatus.mutate({ name: newName.trim(), category: cat.key, color: defaultColor })
                          if (e.key === 'Escape') setAddingTo(null)
                        }}
                      />
                      <button
                        className="btn-primary !py-1 text-xs"
                        disabled={!newName.trim() || createStatus.isPending}
                        onClick={() => createStatus.mutate({ name: newName.trim(), category: cat.key, color: defaultColor })}
                      >
                        Add
                      </button>
                      <button className="btn-ghost !py-1 text-xs" onClick={() => setAddingTo(null)}>
                        Cancel
                      </button>
                    </div>
                  ) : (
                    <button
                      className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-xs text-fg-muted transition-colors hover:bg-ink-750 hover:text-fg-secondary"
                      onClick={() => {
                        setAddingTo(cat.key)
                        setNewName('')
                      }}
                    >
                      <Plus size={13} /> Add status
                    </button>
                  ))}
              </div>
            </div>
          )
        })}
      </div>
    </Modal>
  )
}

function StatusRow({
  status,
  canManage,
  onRecolor,
  onRename,
  onDelete,
}: {
  status: CustomStatus
  canManage: boolean
  onRecolor: (color: string) => void
  onRename: (name: string) => void
  onDelete: () => void
}) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(status.name)
  return (
    <div className="group flex items-center gap-2.5 rounded-lg border border-ink-700 bg-ink-900/50 px-2.5 py-1.5">
      {canManage ? (
        <Dropdown
          width="w-auto"
          trigger={
            <button
              className="h-3.5 w-3.5 shrink-0 rounded-full ring-offset-1 ring-offset-ink-850 transition-transform hover:scale-110"
              style={{ backgroundColor: status.color }}
              title="Change color"
            />
          }
        >
          {(close) => (
            <div className="grid grid-cols-8 gap-1 p-1">
              {ENTITY_COLORS.map((c) => (
                <button
                  key={c}
                  className={cn(
                    'flex h-6 w-6 items-center justify-center rounded-md transition-transform hover:scale-110',
                    c.toLowerCase() === status.color.toLowerCase() && 'ring-2 ring-white ring-offset-1 ring-offset-ink-850',
                  )}
                  style={{ backgroundColor: c }}
                  onClick={() => {
                    onRecolor(c)
                    close()
                  }}
                >
                  {c.toLowerCase() === status.color.toLowerCase() && <Check size={12} className="text-white" strokeWidth={3} />}
                </button>
              ))}
            </div>
          )}
        </Dropdown>
      ) : (
        <span className="h-3.5 w-3.5 shrink-0 rounded-full" style={{ backgroundColor: status.color }} />
      )}

      {editing ? (
        <input
          autoFocus
          className="input-dark !py-0.5 min-w-0 flex-1 text-sm"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && draft.trim()) {
              onRename(draft.trim())
              setEditing(false)
            }
            if (e.key === 'Escape') {
              setDraft(status.name)
              setEditing(false)
            }
          }}
          onBlur={() => {
            if (draft.trim() && draft !== status.name) onRename(draft.trim())
            setEditing(false)
          }}
        />
      ) : (
        <button
          className="min-w-0 flex-1 truncate text-left text-sm text-fg disabled:cursor-default"
          disabled={!canManage}
          onClick={() => setEditing(true)}
        >
          {status.name}
        </button>
      )}

      {canManage && (
        <button
          className="shrink-0 rounded p-1 text-fg-muted opacity-0 transition-opacity hover:bg-ink-750 hover:text-rose-400 group-hover:opacity-100"
          title="Delete status"
          onClick={onDelete}
        >
          <Trash2 size={13} />
        </button>
      )}
    </div>
  )
}
