import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Plus, Trash2 } from 'lucide-react'
import { useState } from 'react'

import { api, errorMessage } from '../../lib/api'
import type { CustomFieldDef, CustomFieldType, TaskDetail } from '../../lib/types'
import { toast } from '../../stores/toast'

const FIELD_TYPES: CustomFieldType[] = ['text', 'number', 'date', 'select', 'checkbox']

export function CustomFields({ task, canManage }: { task: TaskDetail; canManage: boolean }) {
  const queryClient = useQueryClient()
  const [adding, setAdding] = useState(false)
  const [name, setName] = useState('')
  const [type, setType] = useState<CustomFieldType>('text')
  const [options, setOptions] = useState('')
  const onError = (err: unknown) => toast.error(errorMessage(err))

  const defs = useQuery({
    queryKey: ['custom-fields', task.project_id],
    queryFn: () => api.get<CustomFieldDef[]>(`/projects/${task.project_id}/custom-fields`),
  })

  const valueFor = (fieldId: string) =>
    (task.custom_fields ?? []).find((v) => v.field_id === fieldId)?.value?.v

  const setValue = useMutation({
    mutationFn: (v: { fieldId: string; value: unknown }) =>
      api.put(`/tasks/${task.id}/custom-fields/${v.fieldId}`, { value: { v: v.value } }),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['task', task.id] }),
    onError,
  })

  const createField = useMutation({
    mutationFn: () =>
      api.post(`/projects/${task.project_id}/custom-fields`, {
        name: name.trim(),
        field_type: type,
        options: type === 'select' ? options.split(',').map((o) => o.trim()).filter(Boolean) : [],
      }),
    onSuccess: () => {
      setAdding(false); setName(''); setOptions(''); setType('text')
      void queryClient.invalidateQueries({ queryKey: ['custom-fields', task.project_id] })
    },
    onError,
  })

  const deleteField = useMutation({
    mutationFn: (id: string) => api.delete(`/custom-fields/${id}`),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['custom-fields', task.project_id] }),
    onError,
  })

  const fields = defs.data ?? []

  return (
    <div className="mt-8">
      <div className="mb-2 flex items-center justify-between">
        <h3 className="text-sm font-semibold text-fg">Fields</h3>
        {canManage && !adding && (
          <button className="btn-ghost !px-2 !py-1 text-xs" onClick={() => setAdding(true)}>
            <Plus size={13} /> Create a field
          </button>
        )}
      </div>

      {fields.length === 0 && !adding && <p className="text-xs text-fg-muted">No custom fields.</p>}

      <div className="space-y-2">
        {fields.map((f) => (
          <div key={f.id} className="group flex items-center gap-3">
            <span className="w-40 shrink-0 truncate text-sm text-fg-secondary">{f.name}</span>
            <div className="min-w-0 flex-1">
              <FieldInput field={f} value={valueFor(f.id)} onSave={(value) => setValue.mutate({ fieldId: f.id, value })} />
            </div>
            {canManage && (
              <button className="text-fg-muted opacity-0 hover:text-red-400 group-hover:opacity-100" onClick={() => deleteField.mutate(f.id)} title="Delete field">
                <Trash2 size={13} />
              </button>
            )}
          </div>
        ))}
      </div>

      {adding && (
        <div className="mt-3 flex flex-wrap items-center gap-2 rounded-lg border border-ink-700 bg-ink-900 p-3">
          <input className="input-dark !py-1 text-sm" placeholder="Field name" value={name} onChange={(e) => setName(e.target.value)} />
          <select className="input-dark !w-32 !py-1 text-sm" value={type} onChange={(e) => setType(e.target.value as CustomFieldType)}>
            {FIELD_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
          {type === 'select' && (
            <input className="input-dark !py-1 text-sm" placeholder="Options, comma-separated" value={options} onChange={(e) => setOptions(e.target.value)} />
          )}
          <button className="btn-primary !py-1 text-xs" disabled={!name.trim() || createField.isPending} onClick={() => createField.mutate()}>Add</button>
          <button className="btn-ghost !py-1 text-xs" onClick={() => setAdding(false)}>Cancel</button>
        </div>
      )}
    </div>
  )
}

function FieldInput({ field, value, onSave }: { field: CustomFieldDef; value: unknown; onSave: (v: unknown) => void }) {
  if (field.field_type === 'checkbox') {
    return <input type="checkbox" checked={!!value} onChange={(e) => onSave(e.target.checked)} />
  }
  if (field.field_type === 'select') {
    return (
      <select className="input-dark !py-1 text-sm" value={(value as string) ?? ''} onChange={(e) => onSave(e.target.value)}>
        <option value="">—</option>
        {field.options.map((o) => <option key={o} value={o}>{o}</option>)}
      </select>
    )
  }
  const inputType = field.field_type === 'number' ? 'number' : field.field_type === 'date' ? 'date' : 'text'
  return (
    <input
      type={inputType}
      className="input-dark !py-1 text-sm"
      defaultValue={(value as string | number | undefined) ?? ''}
      onBlur={(e) => {
        const raw = e.target.value
        const next = field.field_type === 'number' ? (raw === '' ? null : Number(raw)) : raw
        if (next !== (value ?? '')) onSave(next)
      }}
      placeholder="Empty"
    />
  )
}
