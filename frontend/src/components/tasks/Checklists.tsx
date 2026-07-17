import { useMutation, useQueryClient } from '@tanstack/react-query'
import { CheckSquare, Plus, Trash2 } from 'lucide-react'
import { useState } from 'react'

import { api, errorMessage } from '../../lib/api'
import type { Checklist, TaskDetail } from '../../lib/types'
import { toast } from '../../stores/toast'

export function Checklists({ task, canEdit = true }: { task: TaskDetail; canEdit?: boolean }) {
  const queryClient = useQueryClient()
  const invalidate = () => void queryClient.invalidateQueries({ queryKey: ['task', task.id] })
  const onError = (err: unknown) => toast.error(errorMessage(err))

  const addChecklist = useMutation({
    mutationFn: () => api.post(`/tasks/${task.id}/checklists`, { name: 'Checklist' }),
    onSuccess: invalidate,
    onError,
  })

  const checklists = task.checklists ?? []
  if (checklists.length === 0 && !canEdit) return null

  return (
    <div className="mt-8">
      <div className="mb-2 flex items-center justify-between">
        <h3 className="flex items-center gap-2 text-sm font-semibold text-fg">
          <CheckSquare size={14} className="text-fg-secondary" /> Checklists
        </h3>
        {canEdit && (
          <button className="btn-ghost !px-2 !py-1 text-xs" onClick={() => addChecklist.mutate()} disabled={addChecklist.isPending}>
            <Plus size={13} /> Create checklist
          </button>
        )}
      </div>
      {checklists.length === 0 ? (
        <p className="text-xs text-fg-muted">No checklists yet.</p>
      ) : (
        <div className="space-y-4">
          {checklists.map((cl) => (
            <ChecklistBlock key={cl.id} checklist={cl} canEdit={canEdit} onChange={invalidate} />
          ))}
        </div>
      )}
    </div>
  )
}

function ChecklistBlock({
  checklist,
  canEdit,
  onChange,
}: {
  checklist: Checklist
  canEdit: boolean
  onChange: () => void
}) {
  const [newItem, setNewItem] = useState('')
  const onError = (err: unknown) => toast.error(errorMessage(err))

  const addItem = useMutation({
    mutationFn: () => api.post(`/checklists/${checklist.id}/items`, { content: newItem.trim() }),
    onSuccess: () => { setNewItem(''); onChange() },
    onError,
  })
  const toggleItem = useMutation({
    mutationFn: (v: { id: string; is_done: boolean }) => api.patch(`/checklist-items/${v.id}`, { is_done: v.is_done }),
    onSuccess: onChange,
    onError,
  })
  const deleteItem = useMutation({
    mutationFn: (id: string) => api.delete(`/checklist-items/${id}`),
    onSuccess: onChange,
    onError,
  })
  const deleteChecklist = useMutation({
    mutationFn: () => api.delete(`/checklists/${checklist.id}`),
    onSuccess: onChange,
    onError,
  })

  const done = checklist.items.filter((i) => i.is_done).length

  return (
    <div className="rounded-xl border border-ink-700 bg-ink-900/50 p-3">
      <div className="mb-2 flex items-center gap-2">
        <span className="flex-1 text-sm font-medium text-fg">{checklist.name}</span>
        <span className="text-[11px] text-fg-muted">{done}/{checklist.items.length}</span>
        {canEdit && (
          <button className="text-fg-muted hover:text-red-400" title="Delete checklist" onClick={() => deleteChecklist.mutate()}>
            <Trash2 size={13} />
          </button>
        )}
      </div>
      <div className="space-y-1">
        {checklist.items.map((item) => (
          <div key={item.id} className="group flex items-center gap-2">
            <input
              type="checkbox"
              checked={item.is_done}
              disabled={!canEdit}
              onChange={(e) => toggleItem.mutate({ id: item.id, is_done: e.target.checked })}
            />
            <span className={`flex-1 text-sm ${item.is_done ? 'text-fg-muted line-through' : 'text-fg-secondary'}`}>
              {item.content}
            </span>
            {canEdit && (
              <button className="text-fg-muted opacity-0 hover:text-red-400 group-hover:opacity-100" onClick={() => deleteItem.mutate(item.id)}>
                <Trash2 size={12} />
              </button>
            )}
          </div>
        ))}
      </div>
      {canEdit && (
        <input
          className="input-dark mt-2 !py-1 text-sm"
          placeholder="Add an item…"
          value={newItem}
          onChange={(e) => setNewItem(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && newItem.trim() && addItem.mutate()}
        />
      )}
    </div>
  )
}
