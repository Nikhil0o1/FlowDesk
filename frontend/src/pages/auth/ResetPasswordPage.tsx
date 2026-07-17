import { useMemo } from 'react'
import { Link } from 'react-router-dom'

import { consumeAuthTokenFromUrl } from '../../lib/fragmentToken'
import { AuthLogo, AuthShell } from './AuthShell'

export default function ResetPasswordPage() {
  const token = useMemo(() => consumeAuthTokenFromUrl('reset-password'), [])

  if (!token) {
    return (
      <AuthShell>
        <AuthLogo />
        <h1 className="text-[25px] font-extrabold leading-tight tracking-tight text-slate-950">
          Invalid reset link
        </h1>
        <p className="mt-2 text-sm text-slate-500">This password reset link is missing its token.</p>
        <Link to="/login" className="mt-4 text-sm font-medium text-[#0B8FE8] hover:underline">
          Go to login
        </Link>
      </AuthShell>
    )
  }

  return (
    <AuthShell>
      <AuthLogo />
      <h1 className="text-[25px] font-extrabold leading-tight tracking-tight text-slate-950">
        Passwordless sign-in
      </h1>
      <p className="mt-2 max-w-sm text-center text-sm text-slate-500">
        FlowDesk uses Google, Microsoft, or a one-time email code — not passwords. Use the login
        page to access your account.
      </p>
      <Link
        to="/login"
        className="mt-6 inline-flex h-11 w-full items-center justify-center rounded-xl bg-[#0B8FE8] text-sm font-semibold text-white shadow-sm hover:bg-[#0877C9]"
      >
        Go to login
      </Link>
    </AuthShell>
  )
}
