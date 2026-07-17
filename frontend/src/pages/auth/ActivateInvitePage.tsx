import { useQuery } from '@tanstack/react-query'
import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom'

import { activateInvite, api, errorMessage } from '../../lib/api'
import { readAuthTokenFromUrl } from '../../lib/fragmentToken'
import { DEFAULT_LOGIN_LANDING, syncLoginWorkspaceStore } from '../../lib/loginRouting'
import type { InvitePreview } from '../../lib/types'
import { useAuthStore } from '../../stores/auth'
import { AuthLogo, AuthShell } from './AuthShell'

export default function ActivateInvitePage() {
  const { token: pathToken } = useParams<{ token?: string }>()
  const [params] = useSearchParams()
  const navigate = useNavigate()
  const token = useMemo(
    () => readAuthTokenFromUrl(pathToken) ?? '',
    [pathToken],
  )
  useEffect(() => {
    if (token) window.history.replaceState(null, '', '/activate-invite')
  }, [token])
  // In-app notifications carry the invite id instead of the raw token; previewing
  // and accepting by id use the authenticated, email-matched endpoints.
  const inviteId = params.get('invite') ?? ''
  const user = useAuthStore((s) => s.user)

  const [fullName, setFullName] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  const preview = useQuery({
    queryKey: ['invite-preview', inviteId ? `id:${inviteId}` : token],
    queryFn: () =>
      inviteId
        ? api.get<InvitePreview>(`/auth/invites/${inviteId}`)
        : api.post<InvitePreview>('/auth/invite-preview', { token }),
    enabled: !!token || !!inviteId,
    retry: false,
  })

  if (!token && !inviteId) {
    return (
      <AuthShell>
        <AuthLogo />
        <h1 className="text-[25px] font-extrabold leading-tight tracking-tight text-slate-950">Invalid invitation</h1>
        <p className="mt-2 text-sm text-slate-500">This invitation link is missing its token.</p>
        <Link to="/login" className="mt-4 text-sm font-medium text-[#0B8FE8] hover:underline">
          Go to login
        </Link>
      </AuthShell>
    )
  }

  if (preview.isLoading) {
    return (
      <AuthShell>
        <AuthLogo />
        <p className="mt-6 text-sm text-slate-500">Checking your invitation…</p>
      </AuthShell>
    )
  }

  if (preview.isError || !preview.data || preview.data.expired) {
    return (
      <AuthShell>
        <AuthLogo />
        <h1 className="text-[25px] font-extrabold leading-tight tracking-tight text-slate-950">Invitation unavailable</h1>
        <p className="mt-2 max-w-sm text-center text-sm text-slate-500">
          {preview.isError
            ? errorMessage(preview.error)
            : 'This invitation has expired. Ask your admin to send a new one.'}
        </p>
        <Link to="/login" className="mt-4 text-sm font-medium text-[#0B8FE8] hover:underline">
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
        if (inviteId) {
          await api.post('/auth/accept-invite-by-id', { invite_id: inviteId })
        } else {
          await api.post('/auth/accept-invite', { token })
        }
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
        <h1 className="text-[25px] font-extrabold leading-tight tracking-tight text-slate-950">Join {info.target_name}</h1>
        <p className="mt-2 max-w-sm text-center text-sm text-slate-500">
          You've been invited to <strong>{info.target_name}</strong> as <strong>{info.role}</strong>.
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
            className="mt-6 h-11 w-full rounded-xl bg-[#0B8FE8] text-sm font-semibold text-white shadow-sm hover:bg-[#0877C9] disabled:opacity-60"
          >
            {loading ? 'Joining…' : 'Accept invitation'}
          </button>
        ) : (
          <div className="mt-6 w-full text-center">
            <p className="text-sm text-slate-500">Sign in with your existing account to accept.</p>
            <Link
              to={`/login`}
              className="mt-3 inline-flex h-11 w-full items-center justify-center rounded-xl bg-[#0B8FE8] text-sm font-semibold text-white shadow-sm hover:bg-[#0877C9]"
            >
              Sign in to accept
            </Link>
          </div>
        )}
      </AuthShell>
    )
  }

  // New user activation flow (passwordless — sign in afterwards via SSO or email code)
  const valid = fullName.trim().length > 0

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!valid || loading) return
    setLoading(true)
    setError('')
    try {
      const data = await activateInvite(token, fullName.trim())
      syncLoginWorkspaceStore(data.login_context)
      navigate(DEFAULT_LOGIN_LANDING)
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setLoading(false)
    }
  }

  const isOrgOwner = info.scope === 'organization' && info.role === 'owner'

  return (
    <AuthShell>
      <AuthLogo />
      {isOrgOwner ? (
        <>
          <h1 className="text-[25px] font-extrabold leading-tight tracking-tight text-slate-950">
            Welcome to FlowDesk.
          </h1>
          <p className="mt-2 max-w-sm text-center text-sm text-slate-500">
            You're the owner of <strong>{info.target_name}</strong>. Enter your name below to
            activate your account — everything starts with you.
          </p>
        </>
      ) : (
        <>
          <h1 className="text-[25px] font-extrabold leading-tight tracking-tight text-slate-950">
            You're invited to {info.target_name}
          </h1>
          <p className="mt-2 max-w-sm text-center text-sm text-slate-500">
            You've been added as <strong>{info.role}</strong>. Enter your name to set up your
            account — sign in anytime with Google, Microsoft, or a one-time email code.
          </p>
        </>
      )}

      <form onSubmit={onSubmit} className="mt-7 w-full space-y-3">
        <input
          type="text"
          placeholder="Your full name"
          autoFocus
          value={fullName}
          onChange={(e) => setFullName(e.target.value)}
          className="h-11 w-full rounded-xl border border-slate-200 bg-white px-3.5 text-sm text-slate-900 outline-none placeholder:text-slate-400 focus:border-[#0B8FE8] focus:ring-4 focus:ring-[#0B8FE8]/10"
        />
        {error && <p className="text-sm text-red-600">{error}</p>}
        <button
          type="submit"
          disabled={!valid || loading}
          className="h-11 w-full rounded-xl bg-[#0B8FE8] text-sm font-semibold text-white shadow-sm transition-colors hover:bg-[#0877C9] disabled:bg-slate-200 disabled:text-slate-400"
        >
          {loading ? 'Setting up…' : 'Activate account'}
        </button>
      </form>
    </AuthShell>
  )
}
