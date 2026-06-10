import { useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'

import { api, errorMessage } from '../../lib/api'
import { AuthLogo, AuthShell } from './AuthShell'

export default function ResetPasswordPage() {
  const [params] = useSearchParams()
  const navigate = useNavigate()
  const token = params.get('token') ?? ''
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  const valid = password.length >= 8 && password === confirm

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!valid) return
    setLoading(true)
    setError('')
    try {
      await api.post('/auth/reset-password', { token, password })
      navigate('/login')
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setLoading(false)
    }
  }

  if (!token) {
    return (
      <AuthShell>
        <AuthLogo />
        <h1 className="text-2xl font-bold text-gray-900">Invalid link</h1>
        <p className="mt-1 text-sm text-gray-500">This password reset link is missing its token.</p>
        <Link to="/forgot-password" className="mt-4 text-sm font-medium text-blue-600 hover:underline">
          Request a new link
        </Link>
      </AuthShell>
    )
  }

  return (
    <AuthShell>
      <AuthLogo />
      <h1 className="text-2xl font-bold text-gray-900">Choose a new password</h1>
      <p className="mt-1 text-sm text-gray-500">Must be at least 8 characters.</p>

      <form onSubmit={onSubmit} className="mt-7 w-full space-y-3">
        <input
          type="password"
          placeholder="New password"
          autoComplete="new-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className="w-full rounded-lg border border-gray-300 bg-white px-3.5 py-2.5 text-sm text-gray-900 outline-none placeholder:text-gray-400 focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
        />
        <input
          type="password"
          placeholder="Confirm new password"
          autoComplete="new-password"
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
          className="w-full rounded-lg border border-gray-300 bg-white px-3.5 py-2.5 text-sm text-gray-900 outline-none placeholder:text-gray-400 focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
        />
        {confirm && password !== confirm && (
          <p className="text-sm text-amber-600">Passwords don't match yet.</p>
        )}
        {error && <p className="text-sm text-red-600">{error}</p>}
        <button
          type="submit"
          disabled={!valid || loading}
          className="w-full rounded-lg bg-brand py-2.5 text-sm font-semibold text-white transition-colors hover:bg-brand-hover disabled:bg-gray-300 disabled:text-gray-500"
        >
          {loading ? 'Saving…' : 'Reset password'}
        </button>
      </form>

      <Link to="/login" className="mt-4 text-sm font-medium text-blue-600 hover:underline">
        Back to login
      </Link>
    </AuthShell>
  )
}
