import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Calendar, CheckSquare, ChevronDown, Hash, List, Pencil, Plus, Trash2, Type } from 'lucide-react'
import { useState } from 'react'

import { api, errorMessage } from '../../lib/api'
import type { CustomFieldDef, CustomFieldType } from '../../lib/types'
import { toast } from '../../stores/toast'
import { Modal } from '../ui/Modal'

const FIELD_TYPES: { value: CustomFieldType; label: string; icon: React.ReactNode }[] = [
  { value: 'text', label: 'Text', icon: <Type size={14} /> },
  { value: 'number', label: 'Number', icon: <Hash size={14} /> },
  { value: 'date', label: 'Date', icon: <Calendar size={14} /> },
  { value: 'select', label: 'Dropdown', icon: <List size={14} /> },
  { value: 'checkbox', label: 'Checkbox', icon: <CheckSquare size={14} /> },
]

const typeMeta = (t: CustomFieldType) => FIELD_TYPES.find((f) => f.value === t)

/** Project-level custom-field manager (the field DEFINITIONS, not per-task values). */
export function CustomFieldsModal({
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
  const onError = (err: unknown) => toast.error(errorMessage(err))
  const refresh = () => void queryClient.invalidateQueries({ queryKey: ['custom-fields', projectId] })

  const defs = useQuery({
    queryKey: ['custom-fields', projectId],
    queryFn: () => api.get<CustomFieldDef[]>(`/projects/${projectId}/custom-fields`),
    enabled: open,
  })

  const [adding, setAdding] = useState(false)
  const [name, setName] = useState('')
  const [type, setType] = useState<CustomFieldType>('text')
  const [options, setOptions] = useState('')
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editName, setEditName] = useState('')

  const createField = useMutation({
    mutationFn: () =>
      api.post(`/projects/${projectId}/custom-fields`, {
        name: name.trim(),
        field_type: type,
        options: type === 'select' ? options.split(',').map((o) => o.trim()).filter(Boolean) : [],
      }),
    onSuccess: () => {
      setAdding(false)
      setName('')
      setOptions('')
      setType('text')
      refresh()
    },
    onError,
  })

  const renameField = useMutation({
    mutationFn: (v: { id: string; name: string }) => api.patch(`/custom-fields/${v.id}`, { name: v.name }),
    onSuccess: () => {
      setEditingId(null)
      refresh()
    },
    onError,
  })

  const deleteField = useMutation({
    mutationFn: (id: string) => api.delete(`/custom-fields/${id}`),
    onSuccess: refresh,
    onError,
  })

  const fields = defs.data ?? []

  return (
    <Modal open={open} onClose={onClose} title="Custom Fields" width="max-w-lg">
      <div className="space-y-3">
        <p className="text-xs text-fg-muted">
          Fields defined here are available on every task in this project.
        </p>

        <div className="max-h-72 space-y-1 overflow-y-auto">
          {fields.map((f) => (
            <div key={f.id} className="group flex items-center gap-2.5 rounded-lg border border-ink-700 bg-ink-900/50 px-3 py-2">
              <span className="text-fg-muted">{typeMeta(f.field_type)?.icon}</span>
              {editingId === f.id ? (
                <input
                  autoFocus
                  className="input-dark !py-1 min-w-0 flex-1 text-sm"
                  value={editName}
                  onChange={(e) => setEditName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && editName.trim()) renameField.mutate({ id: f.id, name: editName.trim() })
                    if (e.key === 'Escape') setEditingId(null)
                  }}
                  onBlur={() => (editName.trim() && editName !== f.name ? renameField.mutate({ id: f.id, name: editName.trim() }) : setEditingId(null))}
                />
              ) : (
                <span className="min-w-0 flex-1 truncate text-sm text-fg">{f.name}</span>
              )}
              <span className="shrink-0 text-[11px] uppercase tracking-wide text-fg-muted">
                {typeMeta(f.field_type)?.label}
              </span>
              {f.field_type === 'select' && f.options.length > 0 && (
                <span className="shrink-0 text-[11px] text-fg-muted">· {f.options.length} options</span>
              )}
              {canManage && (
                <div className="flex shrink-0 items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100">
                  <button
                    className="rounded p-1 text-fg-muted hover:bg-ink-750 hover:text-fg"
                    title="Rename field"
                    onClick={() => {
                      setEditingId(f.id)
                      setEditName(f.name)
                    }}
                  >
                    <Pencil size={13} />
                  </button>
                  <button
                    className="rounded p-1 text-fg-muted hover:bg-ink-750 hover:text-rose-400"
                    title="Delete field"
                    onClick={() => deleteField.mutate(f.id)}
                  >
                    <Trash2 size={13} />
                  </button>
                </div>
              )}
            </div>
          ))}
          {fields.length === 0 && !defs.isLoading && (
            <p className="rounded-lg border border-dashed border-ink-700 px-3 py-6 text-center text-xs text-fg-muted">
              No custom fields yet.
            </p>
          )}
        </div>

        {canManage &&
          (adding ? (
            <div className="space-y-2 rounded-lg border border-ink-700 bg-ink-900 p-3">
              <div className="flex gap-2">
                <input
                  autoFocus
                  className="input-dark !py-1.5 min-w-0 flex-1 text-sm"
                  placeholder="Field name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && name.trim() && createField.mutate()}
                />
                <div className="relative shrink-0">
                  <select
                    className="input-dark !py-1.5 !pr-7 text-sm"
                    value={type}
                    onChange={(e) => setType(e.target.value as CustomFieldType)}
                  >
                    {FIELD_TYPES.map((t) => (
                      <option key={t.value} value={t.value}>
                        {t.label}
                      </option>
                    ))}
                  </select>
                  <ChevronDown size={13} className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-fg-muted" />
                </div>
              </div>
              {type === 'select' && (
                <input
                  className="input-dark !py-1.5 text-sm"
                  placeholder="Options, comma-separated (e.g. Low, Medium, High)"
                  value={options}
                  onChange={(e) => setOptions(e.target.value)}
                />
              )}
              <div className="flex justify-end gap-2">
                <button className="btn-ghost !py-1 text-xs" onClick={() => setAdding(false)}>
                  Cancel
                </button>
                <button
                  className="btn-primary !py-1 text-xs"
                  disabled={!name.trim() || createField.isPending}
                  onClick={() => createField.mutate()}
                >
                  Add field
                </button>
              </div>
            </div>
          ) : (
            <button
              className="flex w-full items-center justify-center gap-2 rounded-lg border border-dashed border-ink-700 py-2 text-sm text-fg-secondary transition-colors hover:border-brand hover:text-fg"
              onClick={() => setAdding(true)}
            >
              <Plus size={14} /> Create new field
            </button>
          ))}
      </div>
    </Modal>
  )
}
