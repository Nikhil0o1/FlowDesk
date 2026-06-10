import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'

import { activateInvite, api, errorMessage } from '../../lib/api'
import type { InvitePreview } from '../../lib/types'
import { useAuthStore } from '../../stores/auth'
import { AuthLogo, AuthShell } from './AuthShell'

export default function ActivateInvitePage() {
  const [params] = useSearchParams()
  const navigate = useNavigate()
  const token = params.get('token') ?? ''
  const user = useAuthStore((s) => s.user)

  const [fullName, setFullName] = useState('')
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  const preview = useQuery({
    queryKey: ['invite-preview', token],
    queryFn: () => api.get<InvitePreview>(`/auth/invite-preview?token=${encodeURIComponent(token)}`),
    enabled: !!token,
    retry: false,
  })

  if (!token) {
    return (
      <AuthShell>
        <AuthLogo />
        <h1 className="text-2xl font-bold text-gray-900">Invalid invitation</h1>
        <p className="mt-1 text-sm text-gray-500">This invitation link is missing its token.</p>
        <Link to="/login" className="mt-4 text-sm font-medium text-blue-600 hover:underline">
          Go to login
        </Link>
      </AuthShell>
    )
  }

  if (preview.isLoading) {
    return (
      <AuthShell>
        <AuthLogo />
        <p className="mt-6 text-sm text-gray-500">Checking your invitation…</p>
      </AuthShell>
    )
  }

  if (preview.isError || !preview.data || preview.data.expired) {
    return (
      <AuthShell>
        <AuthLogo />
        <h1 className="text-2xl font-bold text-gray-900">Invitation unavailable</h1>
        <p className="mt-2 max-w-sm text-center text-sm text-gray-500">
          {preview.isError
            ? errorMessage(preview.error)
            : 'This invitation has expired. Ask your admin to send a new one.'}
        </p>
        <Link to="/login" className="mt-4 text-sm font-medium text-blue-600 hover:underline">
          Go to login
        </Link>
      </AuthShell>
    )
  }

  const info = preview.data

  // Existing user flow: accept the invite (no password change)
  if (info.existing_user) {
    const accept = async () => {
      setLoading(true)
      setError('')
      try {
        await api.post('/auth/accept-invite', { token })
        navigate('/app/dashboard')
      } catch (err) {
        setError(errorMessage(err))
      } finally {
        setLoading(false)
      }
    }
    return (
      <AuthShell>
        <AuthLogo />
        <h1 className="text-2xl font-bold text-gray-900">Join {info.target_name}</h1>
        <p className="mt-2 max-w-sm text-center text-sm text-gray-500">
          You've been invited to the <strong>{info.target_name}</strong> {info.scope} in{' '}
          {info.organization_name} as <strong>{info.role}</strong>.
        </p>
        {user && user.email !== info.email && (
          <p className="mt-3 text-sm text-amber-600">
            This invite is for {info.email}, but you're signed in as {user.email}.
          </p>
        )}
        {error && <p className="mt-3 text-sm text-red-600">{error}</p>}
        {user ? (
          <button
            onClick={accept}
            disabled={loading}
            className="mt-6 w-full rounded-lg bg-brand py-2.5 text-sm font-semibold text-white hover:bg-brand-hover disabled:opacity-60"
          >
            {loading ? 'Joining…' : 'Accept invitation'}
          </button>
        ) : (
          <div className="mt-6 w-full text-center">
            <p className="text-sm text-gray-500">Sign in with your existing account to accept.</p>
            <Link
              to={`/login`}
              className="mt-3 inline-block w-full rounded-lg bg-brand py-2.5 text-sm font-semibold text-white hover:bg-brand-hover"
            >
              Sign in to accept
            </Link>
          </div>
        )}
      </AuthShell>
    )
  }

  // New user activation flow
  const valid = fullName.trim().length > 0 && password.length >= 8 && password === confirm

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!valid) return
    setLoading(true)
    setError('')
    try {
      await activateInvite(token, fullName.trim(), password)
      navigate('/app/dashboard')
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setLoading(false)
    }
  }

  return (
    <AuthShell>
      <AuthLogo />
      <h1 className="text-2xl font-bold text-gray-900">You're invited!</h1>
      <p className="mt-2 max-w-sm text-center text-sm text-gray-500">
        Join <strong>{info.target_name}</strong> in {info.organization_name} as{' '}
        <strong>{info.role}</strong>. Create your account for <strong>{info.email}</strong>.
      </p>

      <form onSubmit={onSubmit} className="mt-7 w-full space-y-3">
        <input
          type="text"
          placeholder="Your full name"
          value={fullName}
          onChange={(e) => setFullName(e.target.value)}
          className="w-full rounded-lg border border-gray-300 bg-white px-3.5 py-2.5 text-sm text-gray-900 outline-none placeholder:text-gray-400 focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
        />
        <input
          type="password"
          placeholder="Choose a password (8+ characters)"
          autoComplete="new-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className="w-full rounded-lg border border-gray-300 bg-white px-3.5 py-2.5 text-sm text-gray-900 outline-none placeholder:text-gray-400 focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
        />
        <input
          type="password"
          placeholder="Confirm password"
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
          {loading ? 'Creating account…' : 'Activate account'}
        </button>
      </form>
    </AuthShell>
  )
}
