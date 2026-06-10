import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  ArrowDown,
  ArrowLeft,
  ArrowUp,
  Copy,
  ExternalLink,
  Plus,
  Trash2,
} from 'lucide-react'
import { useEffect, useState } from 'react'
import { useNavigate, useParams, useSearchParams } from 'react-router-dom'

import { api, errorMessage } from '../../lib/api'
import type { FormDef, FormField, FormFieldType, FormSubmission, Page } from '../../lib/types'
import { cn, formatDateTime } from '../../lib/utils'
import { toast } from '../../stores/toast'
import { CenteredSpinner } from '../../components/ui/Spinner'

const FIELD_TYPES: { type: FormFieldType; label: string }[] = [
  { type: 'text', label: 'Short text' },
  { type: 'textarea', label: 'Long text' },
  { type: 'select', label: 'Dropdown' },
  { type: 'date', label: 'Date' },
  { type: 'email', label: 'Email' },
]

let fieldSeq = Date.now()
const newFieldId = () => `f-${(fieldSeq++).toString(36)}`

export default function FormBuilderPage() {
  const { formId } = useParams<{ formId: string }>()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [params, setParams] = useSearchParams()
  const tab = params.get('tab') === 'submissions' ? 'submissions' : 'builder'

  const { data: form, isLoading } = useQuery({
    queryKey: ['form', formId],
    queryFn: () => api.get<FormDef>(`/forms/${formId}`),
    enabled: !!formId,
  })

  const [fields, setFields] = useState<FormField[] | null>(null)
  const [dirty, setDirty] = useState(false)

  useEffect(() => {
    if (form && fields === null) setFields(form.fields)
  }, [form, fields])

  const save = useMutation({
    mutationFn: (body: Record<string, unknown>) => api.patch<FormDef>(`/forms/${formId}`, body),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['form', formId] })
      void queryClient.invalidateQueries({ queryKey: ['forms'] })
      setDirty(false)
    },
    onError: (err) => toast.error(errorMessage(err)),
  })

  if (isLoading || !form || fields === null) return <CenteredSpinner />

  const publicUrl = `${window.location.origin}/f/${form.public_token}`

  const updateFields = (next: FormField[]) => {
    setFields(next)
    setDirty(true)
  }

  const copyLink = async () => {
    await navigator.clipboard.writeText(publicUrl)
    toast.success('Public link copied')
  }

  return (
    <div className="mx-auto max-w-6xl px-8 py-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        <button className="btn-ghost !px-2" onClick={() => navigate('/app/forms')}>
          <ArrowLeft size={16} />
        </button>
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-lg font-bold text-fg">{form.name}</h1>
          <p className="text-xs text-fg-muted">Creates tasks in {form.project_name}</p>
        </div>
        <label className="flex cursor-pointer items-center gap-2 text-xs text-fg-secondary">
          <input
            type="checkbox"
            className="accent-brand"
            checked={form.is_active}
            onChange={(e) => save.mutate({ is_active: e.target.checked })}
          />
          {form.is_active ? 'Accepting submissions' : 'Paused'}
        </label>
        <button className="btn-secondary !py-1.5 text-xs" onClick={() => navigate(`/app/forms/${form.id}/fill`)}>
          Fill out
        </button>
        <button className="btn-secondary !py-1.5 text-xs" onClick={copyLink}>
          <Copy size={13} /> Copy link
        </button>
        <a href={publicUrl} target="_blank" rel="noreferrer" className="btn-secondary !py-1.5 text-xs">
          <ExternalLink size={13} /> Open
        </a>
        {tab === 'builder' && (
          <button
            className="btn-primary !py-1.5 text-xs"
            disabled={!dirty || save.isPending}
            onClick={() => save.mutate({ fields })}
          >
            {save.isPending ? 'Saving…' : dirty ? 'Save changes' : 'Saved'}
          </button>
        )}
      </div>

      {/* Tabs */}
      <div className="mt-4 flex gap-1 border-b border-ink-700">
        {(['builder', 'submissions'] as const).map((t) => (
          <button
            key={t}
            onClick={() => {
              if (t === 'submissions') params.set('tab', 'submissions')
              else params.delete('tab')
              setParams(params, { replace: true })
            }}
            className={cn(
              'border-b-2 px-3 py-2 text-sm capitalize transition-colors',
              tab === t ? 'border-brand font-medium text-fg' : 'border-transparent text-fg-secondary hover:text-fg',
            )}
          >
            {t}
            {t === 'submissions' && ` (${form.submission_count})`}
          </button>
        ))}
      </div>

      {tab === 'builder' ? (
        <div className="mt-6 grid grid-cols-2 gap-8 max-lg:grid-cols-1">
          <FieldEditor fields={fields} onChange={updateFields} />
          <FormPreview name={form.name} description={form.description} fields={fields} />
        </div>
      ) : (
        <SubmissionsTable formId={form.id} />
      )}
    </div>
  )
}

function FieldEditor({ fields, onChange }: { fields: FormField[]; onChange: (f: FormField[]) => void }) {
  const update = (index: number, patch: Partial<FormField>) => {
    onChange(fields.map((f, i) => (i === index ? { ...f, ...patch } : f)))
  }
  const move = (index: number, dir: -1 | 1) => {
    const target = index + dir
    if (target < 1 || target >= fields.length || index === 0) return // first field is locked
    const next = [...fields]
    ;[next[index], next[target]] = [next[target], next[index]]
    onChange(next)
  }
  const remove = (index: number) => {
    if (index === 0) return
    onChange(fields.filter((_, i) => i !== index))
  }
  const add = (type: FormFieldType) => {
    onChange([
      ...fields,
      {
        id: newFieldId(),
        type,
        label: FIELD_TYPES.find((t) => t.type === type)?.label ?? 'Field',
        required: false,
        ...(type === 'select' ? { options: ['Option 1', 'Option 2'] } : {}),
      },
    ])
  }

  return (
    <div>
      <h2 className="mb-3 text-sm font-semibold text-fg">Fields</h2>
      <div className="space-y-2.5">
        {fields.map((field, index) => (
          <div key={field.id} className="rounded-xl border border-ink-700 bg-ink-850/60 p-3.5">
            <div className="flex items-center gap-2">
              <input
                className="min-w-0 flex-1 rounded-lg border border-ink-700 bg-ink-800 px-2.5 py-1.5 text-sm text-fg outline-none focus:border-brand"
                value={field.label}
                onChange={(e) => update(index, { label: e.target.value })}
              />
              <select
                className="rounded-lg border border-ink-700 bg-ink-800 px-2 py-1.5 text-xs text-fg-secondary outline-none disabled:opacity-50"
                value={field.type}
                disabled={index === 0}
                onChange={(e) => {
                  const type = e.target.value as FormFieldType
                  update(index, {
                    type,
                    options: type === 'select' ? field.options ?? ['Option 1', 'Option 2'] : undefined,
                  })
                }}
              >
                {FIELD_TYPES.map((t) => (
                  <option key={t.type} value={t.type}>
                    {t.label}
                  </option>
                ))}
              </select>
            </div>
            {field.type === 'select' && (
              <input
                className="mt-2 w-full rounded-lg border border-ink-700 bg-ink-800 px-2.5 py-1.5 text-xs text-fg outline-none focus:border-brand"
                placeholder="Options, comma separated"
                value={(field.options ?? []).join(', ')}
                onChange={(e) =>
                  update(index, { options: e.target.value.split(',').map((o) => o.trim()).filter(Boolean) })
                }
              />
            )}
            <div className="mt-2.5 flex items-center gap-3">
              <label className="flex cursor-pointer items-center gap-1.5 text-xs text-fg-secondary">
                <input
                  type="checkbox"
                  className="accent-brand"
                  checked={field.required}
                  disabled={index === 0}
                  onChange={(e) => update(index, { required: e.target.checked })}
                />
                Required
              </label>
              <span className="flex-1" />
              {index === 0 ? (
                <span className="text-[11px] text-fg-muted">Task name (always first)</span>
              ) : (
                <>
                  <button className="btn-ghost !p-1" onClick={() => move(index, -1)} disabled={index <= 1} title="Move up">
                    <ArrowUp size={13} />
                  </button>
                  <button className="btn-ghost !p-1" onClick={() => move(index, 1)} disabled={index >= fields.length - 1} title="Move down">
                    <ArrowDown size={13} />
                  </button>
                  <button className="btn-ghost !p-1 hover:!text-red-400" onClick={() => remove(index)} title="Delete field">
                    <Trash2 size={13} />
                  </button>
                </>
              )}
            </div>
          </div>
        ))}
      </div>

      <div className="mt-3 flex flex-wrap gap-2">
        {FIELD_TYPES.map((t) => (
          <button key={t.type} className="btn-secondary !py-1.5 text-xs" onClick={() => add(t.type)}>
            <Plus size={12} /> {t.label}
          </button>
        ))}
      </div>
    </div>
  )
}

export function FormFieldsRenderer({
  fields,
  values,
  onChange,
  light,
}: {
  fields: FormField[]
  values: Record<string, string>
  onChange: (id: string, value: string) => void
  light?: boolean
}) {
  const inputCls = light
    ? 'w-full rounded-lg border border-gray-300 bg-white px-3.5 py-2.5 text-sm text-gray-900 outline-none placeholder:text-gray-400 focus:border-brand focus:ring-2 focus:ring-brand/20'
    : 'input-dark'
  const labelCls = light ? 'mb-1.5 block text-sm font-medium text-gray-800' : 'mb-1.5 block text-xs font-medium text-fg-secondary'
  return (
    <div className="space-y-4">
      {fields.map((field) => (
        <div key={field.id}>
          <label className={labelCls}>
            {field.label}
            {field.required && <span className="text-red-400"> *</span>}
          </label>
          {field.type === 'textarea' ? (
            <textarea rows={4} className={cn(inputCls, 'resize-y')} value={values[field.id] ?? ''} onChange={(e) => onChange(field.id, e.target.value)} />
          ) : field.type === 'select' ? (
            <select className={inputCls} value={values[field.id] ?? ''} onChange={(e) => onChange(field.id, e.target.value)}>
              <option value="">Select…</option>
              {(field.options ?? []).map((o) => (
                <option key={o} value={o}>
                  {o}
                </option>
              ))}
            </select>
          ) : (
            <input
              type={field.type === 'date' ? 'date' : field.type === 'email' ? 'email' : 'text'}
              className={inputCls}
              value={values[field.id] ?? ''}
              onChange={(e) => onChange(field.id, e.target.value)}
            />
          )}
        </div>
      ))}
    </div>
  )
}

function FormPreview({ name, description, fields }: { name: string; description: string | null; fields: FormField[] }) {
  const [values, setValues] = useState<Record<string, string>>({})
  return (
    <div>
      <h2 className="mb-3 text-sm font-semibold text-fg">Live preview</h2>
      <div className="rounded-2xl border border-ink-700 bg-ink-850/60 p-6">
        <h3 className="text-lg font-bold text-fg">{name}</h3>
        {description && <p className="mt-1 text-sm text-fg-secondary">{description}</p>}
        <div className="mt-5">
          <FormFieldsRenderer fields={fields} values={values} onChange={(id, v) => setValues((prev) => ({ ...prev, [id]: v }))} />
        </div>
        <button className="btn-primary mt-5 w-full" disabled>
          Submit (preview)
        </button>
      </div>
    </div>
  )
}

function SubmissionsTable({ formId }: { formId: string }) {
  const navigate = useNavigate()
  const { data, isLoading } = useQuery({
    queryKey: ['form-submissions', formId],
    queryFn: () => api.get<Page<FormSubmission>>(`/forms/${formId}/submissions?page_size=100`),
  })

  if (isLoading) return <CenteredSpinner />
  const items = data?.items ?? []
  if (items.length === 0) {
    return <p className="py-12 text-center text-sm text-fg-muted">No submissions yet. Share the public link to start collecting.</p>
  }

  return (
    <div className="mt-6 overflow-hidden rounded-xl border border-ink-700">
      {items.map((sub) => (
        <div key={sub.id} className="flex items-start gap-3 border-b border-ink-700/60 bg-ink-900 px-4 py-3 last:border-b-0">
          <div className="min-w-0 flex-1">
            <p className="text-sm text-fg">
              {Object.values(sub.data)[0] ?? 'Submission'}
            </p>
            <p className="mt-0.5 truncate text-xs text-fg-muted">
              {Object.entries(sub.data).slice(1).map(([, v]) => v).join(' · ') || '—'}
            </p>
            <p className="mt-1 text-[11px] text-fg-muted">
              {formatDateTime(sub.created_at)}
              {sub.submitter_email ? ` · ${sub.submitter_email}` : ''}
            </p>
          </div>
          {sub.task_id && (
            <button className="btn-secondary !py-1 text-xs" onClick={() => navigate(`/app/tasks/${sub.task_id}`)}>
              {sub.task_ref ?? 'Open task'}
            </button>
          )}
        </div>
      ))}
    </div>
  )
}
