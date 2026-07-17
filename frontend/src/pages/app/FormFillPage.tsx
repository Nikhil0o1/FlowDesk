import { useQuery } from '@tanstack/react-query'
import { ArrowLeft, CheckCircle2, Copy } from 'lucide-react'
import { useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'

import { api, errorMessage } from '../../lib/api'
import { copyPublicFormLink } from '../../lib/publicForms'
import type { FormDef } from '../../lib/types'
import { toast } from '../../stores/toast'
import { CenteredSpinner } from '../../components/ui/Spinner'
import { FormFieldsRenderer } from '../../components/forms/FormFieldsRenderer'

/** In-app form filling for workspace/project members. Submissions create real tasks. */
export default function FormFillPage() {
  const { formId } = useParams<{ formId: string }>()
  const navigate = useNavigate()
  const [values, setValues] = useState<Record<string, string>>({})
  const [result, setResult] = useState<{ task_id: string; task_ref: string } | null>(null)
  const [sending, setSending] = useState(false)

  const { data: form, isLoading, isError, error: loadError } = useQuery({
    queryKey: ['form', formId],
    queryFn: () => api.get<FormDef>(`/forms/${formId}`),
    enabled: !!formId,
    retry: false,
  })

  if (isLoading) return <CenteredSpinner />
  if (isError || !form) {
    return (
      <div className="mx-auto max-w-xl px-6 py-8">
        <button className="btn-ghost mb-4 !px-2 text-xs" onClick={() => navigate('/app/forms')}>
          <ArrowLeft size={14} /> All forms
        </button>
        <div className="rounded-2xl border border-ink-700 bg-ink-850/50 p-7 text-center">
          <h1 className="text-lg font-bold text-fg">Form unavailable</h1>
          <p className="mt-2 text-sm text-fg-secondary">
            {isError ? errorMessage(loadError) : 'You do not have access to this form.'}
          </p>
        </div>
      </div>
    )
  }

  const submit = async () => {
    for (const field of form.fields) {
      if (field.required && !(values[field.id] ?? '').trim()) {
        toast.error(`'${field.label}' is required`)
        return
      }
    }
    setSending(true)
    try {
      const res = await api.post<{ detail: string; task_id: string; task_ref: string }>(
        `/forms/${form.id}/submit`,
        { values },
      )
      setResult({ task_id: res.task_id, task_ref: res.task_ref })
    } catch (err) {
      toast.error(errorMessage(err))
    } finally {
      setSending(false)
    }
  }

  return (
    <div className="mx-auto max-w-xl px-6 py-8">
      <div className="mb-4 flex items-center justify-between gap-3">
        <button className="btn-ghost !px-2 text-xs" onClick={() => navigate('/app/forms')}>
          <ArrowLeft size={14} /> All forms
        </button>
        <button
          className="btn-secondary !py-1.5 text-xs"
          onClick={async () => {
            await copyPublicFormLink(form.public_token)
            toast.success('Link copied')
          }}
        >
          <Copy size={13} /> Copy link
        </button>
      </div>

      <div className="rounded-2xl border border-ink-700 bg-ink-850/50 p-7">
        {result ? (
          <div className="py-6 text-center">
            <CheckCircle2 size={36} className="mx-auto text-emerald-400" />
            <h1 className="mt-4 text-lg font-bold text-fg">Submission received</h1>
            <p className="mt-1 text-sm text-fg-secondary">
              Created task <span className="font-semibold text-fg">{result.task_ref}</span> in{' '}
              {form.project_name}.
            </p>
            <div className="mt-6 flex justify-center gap-3">
              <button className="btn-secondary text-xs" onClick={() => { setValues({}); setResult(null) }}>
                Submit another
              </button>
              <button className="btn-primary text-xs" onClick={() => navigate(`/app/tasks/${result.task_id}`)}>
                Open {result.task_ref}
              </button>
            </div>
          </div>
        ) : (
          <>
            <h1 className="text-xl font-bold text-fg">{form.name}</h1>
            {form.description && <p className="mt-1 text-sm text-fg-secondary">{form.description}</p>}
            <p className="mt-1 text-xs text-fg-muted">Creates a task in {form.project_name}</p>
            <div className="mt-6">
              <FormFieldsRenderer
                fields={form.fields}
                values={values}
                onChange={(id, v) => setValues((prev) => ({ ...prev, [id]: v }))}
              />
            </div>
            <button className="btn-primary mt-6 w-full" disabled={sending} onClick={submit}>
              {sending ? 'Submitting…' : 'Submit'}
            </button>
          </>
        )}
      </div>
    </div>
  )
}
