import { useQuery } from '@tanstack/react-query'
import { CheckCircle2 } from 'lucide-react'
import { useState } from 'react'
import { useParams } from 'react-router-dom'

import { errorMessage } from '../../lib/api'
import type { PublicForm } from '../../lib/types'
import { FormFieldsRenderer } from '../app/FormBuilderPage'

async function fetchPublicForm(token: string): Promise<PublicForm> {
  const res = await fetch(`/api/v1/public/forms/${token}`)
  if (!res.ok) throw new Error((await res.json()).detail ?? 'Form not available')
  return res.json()
}

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
    if (!form) return
    for (const field of form.fields) {
      if (field.required && !(values[field.id] ?? '').trim()) {
        setError(`'${field.label}' is required`)
        return
      }
    }
    setSending(true)
    setError('')
    try {
      const res = await fetch(`/api/v1/public/forms/${token}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ values, submitter_email: email.trim() || null }),
      })
      if (!res.ok) {
        const data = await res.json()
        throw new Error(typeof data.detail === 'string' ? data.detail : 'Submission failed')
      }
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
      style={{
        background:
          'linear-gradient(135deg, #fde8d7 0%, #fbd9e0 18%, #ecdcf5 38%, #ffffff 60%, #e3ecfb 82%, #cfe0f7 100%)',
      }}
    >
      <div className="w-full max-w-lg rounded-2xl border border-gray-200 bg-white p-8 shadow-xl">
        {isLoading ? (
          <p className="py-8 text-center text-sm text-gray-500">Loading form…</p>
        ) : isError || !form ? (
          <div className="py-8 text-center">
            <h1 className="text-xl font-bold text-gray-900">Form unavailable</h1>
            <p className="mt-2 text-sm text-gray-500">{isError ? errorMessage(loadError) : 'This form does not exist or is paused.'}</p>
          </div>
        ) : submitted ? (
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
        ) : (
          <>
            <div className="mb-1 flex items-center gap-2">
              <img src="/logo.svg" alt="" className="h-6 w-6" />
              <span className="text-xs font-medium uppercase tracking-widest text-gray-400">
                {form.workspace_name}
              </span>
            </div>
            <h1 className="text-2xl font-bold text-gray-900">{form.name}</h1>
            {form.description && <p className="mt-1.5 text-sm text-gray-600">{form.description}</p>}

            <div className="mt-6">
              <FormFieldsRenderer
                light
                fields={form.fields}
                values={values}
                onChange={(id, v) => setValues((prev) => ({ ...prev, [id]: v }))}
              />
              <div className="mt-4">
                <label className="mb-1.5 block text-sm font-medium text-gray-800">Your email (optional)</label>
                <input
                  type="email"
                  className="w-full rounded-lg border border-gray-300 bg-white px-3.5 py-2.5 text-sm text-gray-900 outline-none placeholder:text-gray-400 focus:border-brand focus:ring-2 focus:ring-brand/20"
                  placeholder="you@company.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                />
              </div>
            </div>

            {error && <p className="mt-3 text-sm text-red-600">{error}</p>}
            <button
              onClick={submit}
              disabled={sending}
              className="mt-6 w-full rounded-lg bg-brand py-2.5 text-sm font-semibold text-white transition-colors hover:bg-brand-hover disabled:opacity-60"
            >
              {sending ? 'Submitting…' : 'Submit'}
            </button>
          </>
        )}
      </div>
      <p className="mt-6 text-xs text-gray-500">
        Powered by <span className="font-semibold">FlowDesk</span>
      </p>
    </div>
  )
}
