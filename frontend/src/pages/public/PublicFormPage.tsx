import { useQuery } from '@tanstack/react-query'
import { CheckCircle2 } from 'lucide-react'
import { useState } from 'react'
import { useParams } from 'react-router-dom'

import { FormPublicFillCard, FormPublicPoweredBy, PUBLIC_FORM_GRADIENT } from '../../components/forms/FormPublicFillCard'
import { PublicBreadcrumbBar } from '../../components/navigation/PublicBreadcrumbBar'
import { errorMessage } from '../../lib/api'
import { fetchPublicForm, submitPublicForm } from '../../lib/publicForms'

export default function PublicFormPage() {
  const { token } = useParams<{ token: string }>()
  const [values, setValues] = useState<Record<string, string>>({})
  const [email, setEmail] = useState('')
  const [submitted, setSubmitted] = useState(false)
  const [error, setError] = useState('')
  const [sending, setSending] = useState(false)

  const { data: form, isLoading, isError, error: loadError } = useQuery({
    queryKey: ['public-form', token],
    queryFn: () => fetchPublicForm(token!),
    enabled: !!token,
    retry: false,
  })

  const submit = async () => {
    if (!form || !form.is_active) return
    for (const field of form.fields) {
      if (field.required && !(values[field.id] ?? '').trim()) {
        setError(`'${field.label}' is required`)
        return
      }
    }
    setSending(true)
    setError('')
    try {
      await submitPublicForm(token!, { values, submitter_email: email.trim() || null })
      setSubmitted(true)
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setSending(false)
    }
  }

  return (
    <div
      className="flex min-h-screen flex-col items-center px-4 py-[10vh]"
      style={{ background: PUBLIC_FORM_GRADIENT }}
    >
      <div className="w-full max-w-lg">
        {!isLoading && (
          <PublicBreadcrumbBar
            items={[
              { label: 'Shared form' },
              {
                label: form?.name ?? (isError ? 'Unavailable' : 'Loading…'),
                current: true,
              },
            ]}
          />
        )}
        {isLoading ? (
          <div className="rounded-2xl border border-gray-200 bg-white p-8 shadow-xl">
            <p className="py-8 text-center text-sm text-gray-500">Loading form…</p>
          </div>
        ) : isError || !form ? (
          <div className="rounded-2xl border border-gray-200 bg-white p-8 shadow-xl">
            <div className="py-8 text-center">
              <h1 className="text-xl font-bold text-gray-900">Form unavailable</h1>
              <p className="mt-2 text-sm text-gray-500">
                {isError ? errorMessage(loadError) : 'This form does not exist or is paused.'}
              </p>
            </div>
          </div>
        ) : submitted ? (
          <div className="rounded-2xl border border-gray-200 bg-white p-8 shadow-xl">
            <div className="py-8 text-center">
              <CheckCircle2 size={40} className="mx-auto text-emerald-500" />
              <h1 className="mt-4 text-xl font-bold text-gray-900">Thanks! Submission received.</h1>
              <p className="mt-1 text-sm text-gray-500">The {form.workspace_name} team will take it from here.</p>
              <button
                className="mt-6 rounded-lg bg-brand px-4 py-2 text-sm font-semibold text-white hover:bg-brand-hover"
                onClick={() => {
                  setValues({})
                  setEmail('')
                  setSubmitted(false)
                }}
              >
                Submit another response
              </button>
            </div>
          </div>
        ) : (
          <FormPublicFillCard
            workspaceName={form.workspace_name}
            name={form.name}
            description={form.description}
            fields={form.fields}
            values={values}
            onChange={(id, v) => setValues((prev) => ({ ...prev, [id]: v }))}
            email={email}
            onEmailChange={setEmail}
            error={error}
            submitting={sending}
            onSubmit={() => void submit()}
            theme="light"
            submitDisabled={!form.is_active}
            paused={!form.is_active}
          />
        )}
      </div>
      <FormPublicPoweredBy className="mt-6" />
    </div>
  )
}
