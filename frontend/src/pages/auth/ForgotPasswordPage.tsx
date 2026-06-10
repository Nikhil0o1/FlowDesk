import { useState } from 'react'
import { Link } from 'react-router-dom'

import { api, errorMessage } from '../../lib/api'
import { AuthLogo, AuthShell } from './AuthShell'

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState('')
  const [sent, setSent] = useState(false)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)
    setError('')
    try {
      await api.post('/auth/forgot-password', { email: email.trim() })
      setSent(true)
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setLoading(false)
    }
  }

  return (
    <AuthShell>
      <AuthLogo />
      <h1 className="text-2xl font-bold text-gray-900">Forgot your password?</h1>
      <p className="mt-1 max-w-sm text-center text-sm text-gray-500">
        Enter your work email and we'll send you a link to reset it.
      </p>

      {sent ? (
        <div className="mt-7 w-full rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-4 text-center text-sm text-emerald-800">
          If an account exists for <strong>{email}</strong>, a reset link is on its way. Check your
          inbox.
        </div>
      ) : (
        <form onSubmit={onSubmit} className="mt-7 w-full space-y-3">
          <input
            type="email"
            placeholder="Work email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="w-full rounded-lg border border-gray-300 bg-white px-3.5 py-2.5 text-sm text-gray-900 outline-none placeholder:text-gray-400 focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
          />
          {error && <p className="text-sm text-red-600">{error}</p>}
          <button
            type="submit"
            disabled={!email.trim() || loading}
            className="w-full rounded-lg bg-brand py-2.5 text-sm font-semibold text-white transition-colors hover:bg-brand-hover disabled:bg-gray-300 disabled:text-gray-500"
          >
            {loading ? 'Sending…' : 'Send reset link'}
          </button>
        </form>
      )}

      <Link to="/login" className="mt-4 text-sm font-medium text-blue-600 hover:underline">
        Back to login
      </Link>
    </AuthShell>
  )
}
