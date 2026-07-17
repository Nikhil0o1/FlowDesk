import { useEffect, useRef, useState } from 'react'
import { Navigate, useNavigate } from 'react-router-dom'
import { QRCodeSVG } from 'qrcode.react'

import {
  API_ORIGIN,
  confirm2faLogin,
  errorMessage,
  loginWithGoogle,
  requestLoginOtp,
  setup2faLogin,
  verify2fa,
  verifyLoginOtp,
} from '../../lib/api'
import { mountGoogleSignInButton, resetAuthClientState } from '../../lib/googleAuth'
import { loginLandingPath, syncLoginWorkspaceStore } from '../../lib/loginRouting'
import { microsoftConfigured, microsoftLoginErrorMessage, microsoftLoginRedirect } from '../../lib/msal'
import { useAuthStore } from '../../stores/auth'
import { AuthLogo, AuthShell, MicrosoftIcon } from './AuthShell'

type Step = 'email' | 'code' | 'totp' | 'totp-enroll'

export default function LoginPage() {
  const navigate = useNavigate()
  const { user, loginContext, initialized } = useAuthStore()
  const [step, setStep] = useState<Step>('email')
  const [email, setEmail] = useState('')
  const [code, setCode] = useState('')
  const [note, setNote] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [msLoading, setMsLoading] = useState(false)
  // 2FA state
  const [challengeToken, setChallengeToken] = useState('')
  const [totpCode, setTotpCode] = useState('')
  const [enroll, setEnroll] = useState<{ secret: string; uri: string } | null>(null)
  const [recoveryCodes, setRecoveryCodes] = useState<string[] | null>(null)

  // Surface errors from a failed Microsoft redirect (handled in main.tsx on boot).
  useEffect(() => {
    const msErr = sessionStorage.getItem('flowdesk.ms_login_error')
    if (msErr) {
      setError(msErr)
      sessionStorage.removeItem('flowdesk.ms_login_error')
    }
  }, [])

  // Surface errors from the Google OAuth redirect (e.g. user denied access).
  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const err = params.get('error')
    if (err === 'google_failed') setError('Google sign-in failed. Please try again.')
    if (err === 'google_unauthorized') setError('You do not have permission to sign in. Access is by invitation only.')
    if (err) window.history.replaceState(null, '', window.location.pathname)
  }, [])

  if (initialized && user && loginContext) {
    return <Navigate to={loginLandingPath(loginContext)} replace />
  }

  const emailValid = /.+@.+\..+/.test(email.trim())

  const sendCode = async () => {
    if (!emailValid || loading) return
    setLoading(true)
    setError('')
    setNote('')
    try {
      await requestLoginOtp(email.trim())
      setStep('code')
      setCode('')
      setNote(`We sent a 6-digit code to ${email.trim()} if that email has access.`)
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setLoading(false)
    }
  }

  const verifyCode = async () => {
    if (code.trim().length < 4 || loading) return
    setLoading(true)
    setError('')
    try {
      const data = await verifyLoginOtp(email.trim(), code.trim())
      if (data.status === 'authenticated' && data.login_context) {
        syncLoginWorkspaceStore(data.login_context)
        navigate(loginLandingPath(data.login_context))
        return
      }
      setChallengeToken(data.challenge_token || '')
      setTotpCode('')
      setNote('')
      if (data.status === 'totp_required') {
        setStep('totp')
      } else {
        // org enforces 2FA but this account isn't enrolled yet — set it up now
        const setup = await setup2faLogin(data.challenge_token || '')
        setEnroll({ secret: setup.secret, uri: setup.otpauth_uri })
        setStep('totp-enroll')
      }
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setLoading(false)
    }
  }

  const verifyTotp = async () => {
    if (totpCode.trim().length < 4 || loading) return
    setLoading(true)
    setError('')
    try {
      const data = await verify2fa(challengeToken, totpCode.trim())
      syncLoginWorkspaceStore(data.login_context)
      navigate(loginLandingPath(data.login_context))
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setLoading(false)
    }
  }

  const confirmEnroll = async () => {
    if (totpCode.trim().length < 6 || loading) return
    setLoading(true)
    setError('')
    try {
      const data = await confirm2faLogin(challengeToken, totpCode.trim())
      setRecoveryCodes(data.recovery_codes) // session is established; show codes before continuing
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setLoading(false)
    }
  }

  const finishEnroll = () => {
    const ctx = useAuthStore.getState().loginContext
    if (ctx) {
      syncLoginWorkspaceStore(ctx)
      navigate(loginLandingPath(ctx))
    }
  }

  const onMicrosoftClick = async () => {
    setError('')
    if (!microsoftConfigured) {
      setError('Microsoft SSO is not configured. Set VITE_MICROSOFT_CLIENT_ID (and MICROSOFT_CLIENT_ID on the API).')
      return
    }
    setMsLoading(true)
    try {
      resetAuthClientState()
      // Full-page redirect to Microsoft; the response is completed on boot in main.tsx.
      await microsoftLoginRedirect()
    } catch (err) {
      setMsLoading(false)
      setError(microsoftLoginErrorMessage(err))
    }
  }

  const inputClass =
    'h-11 w-full rounded-xl border border-slate-200 bg-white px-3.5 text-sm text-slate-900 outline-none transition-shadow placeholder:text-slate-400 focus:border-[#0B8FE8] focus:ring-4 focus:ring-[#0B8FE8]/10'
  const primaryBtn =
    'h-11 w-full rounded-xl bg-[#0B8FE8] text-sm font-semibold text-white shadow-sm transition-colors hover:bg-[#0877C9] disabled:bg-slate-200 disabled:text-slate-400'

  const headings: Record<Step, [string, string]> = {
    email: ['Welcome back!', 'Sign in to your workspace'],
    code: ['Welcome back!', 'Sign in to your workspace'],
    totp: ['Two-factor authentication', 'Enter the code from your authenticator app'],
    'totp-enroll': ['Set up two-factor authentication', 'Your organization requires 2FA to sign in'],
  }
  const [heading, subheading] = headings[step]

  return (
    <AuthShell>
      <AuthLogo />
      <h1 className="text-[25px] font-extrabold leading-tight tracking-tight text-slate-950">{heading}</h1>
      <p className="mt-2 text-sm text-slate-500">{subheading}</p>

      {(step === 'email' || step === 'code') && (
        <>
          <div className="mt-7 w-full space-y-3">
            <GoogleLoginButton />
            <button
              type="button"
              onClick={onMicrosoftClick}
              disabled={msLoading}
              className="flex h-11 w-full items-center justify-center gap-2.5 rounded-xl border border-slate-200 bg-white text-sm font-semibold text-slate-700 shadow-sm transition-colors hover:bg-slate-50 disabled:opacity-60"
            >
              <MicrosoftIcon />
              {msLoading ? 'Signing in…' : 'Continue with Microsoft'}
            </button>
          </div>

          <div className="my-5 flex w-full items-center gap-3">
            <div className="h-px flex-1 bg-slate-200" />
            <span className="text-xs text-slate-300">or sign in with email</span>
            <div className="h-px flex-1 bg-slate-200" />
          </div>
        </>
      )}

      {step === 'email' && (
        <form
          className="w-full space-y-3.5"
          onSubmit={(e) => {
            e.preventDefault()
            void sendCode()
          }}
        >
          <input
            type="email"
            autoComplete="email"
            placeholder="Work email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className={inputClass}
          />
          {error && <p className="text-sm text-red-600">{error}</p>}
          <button type="submit" disabled={!emailValid || loading} className={primaryBtn}>
            {loading ? 'Sending code…' : 'Send sign-in code'}
          </button>
        </form>
      )}

      {step === 'code' && (
        <form
          className="w-full space-y-3.5"
          onSubmit={(e) => {
            e.preventDefault()
            void verifyCode()
          }}
        >
          {note && <p className="text-xs text-slate-500">{note}</p>}
          <input
            type="text"
            inputMode="numeric"
            autoComplete="one-time-code"
            autoFocus
            placeholder="Enter 6-digit code"
            value={code}
            maxLength={6}
            onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
            className={`${inputClass} text-center text-lg tracking-[0.4em]`}
          />
          {error && <p className="text-sm text-red-600">{error}</p>}
          <button type="submit" disabled={code.trim().length < 4 || loading} className={primaryBtn}>
            {loading ? 'Verifying…' : 'Verify & sign in'}
          </button>
          <div className="flex items-center justify-between text-xs">
            <button type="button" className="font-medium text-[#0B8FE8] hover:underline" onClick={() => void sendCode()} disabled={loading}>
              Resend code
            </button>
            <button
              type="button"
              className="text-slate-400 hover:text-slate-600"
              onClick={() => {
                setStep('email')
                setCode('')
                setError('')
                setNote('')
              }}
            >
              Use a different email
            </button>
          </div>
        </form>
      )}

      {step === 'totp' && (
        <form
          className="mt-7 w-full space-y-3.5"
          onSubmit={(e) => {
            e.preventDefault()
            void verifyTotp()
          }}
        >
          <input
            type="text"
            inputMode="numeric"
            autoComplete="one-time-code"
            autoFocus
            placeholder="Authenticator or recovery code"
            value={totpCode}
            onChange={(e) => setTotpCode(e.target.value)}
            className={`${inputClass} text-center text-lg tracking-[0.3em]`}
          />
          {error && <p className="text-sm text-red-600">{error}</p>}
          <button type="submit" disabled={totpCode.trim().length < 4 || loading} className={primaryBtn}>
            {loading ? 'Verifying…' : 'Verify & sign in'}
          </button>
          <p className="text-center text-xs text-slate-400">
            Lost your device? Enter one of your backup recovery codes instead.
          </p>
        </form>
      )}

      {step === 'totp-enroll' && (
        <div className="mt-6 w-full space-y-4">
          {recoveryCodes ? (
            <>
              <p className="text-sm text-slate-600">
                Save these one-time recovery codes somewhere safe. Each can be used once if you lose your
                authenticator.
              </p>
              <div className="grid grid-cols-2 gap-2 rounded-xl border border-slate-200 bg-slate-50 p-3 font-mono text-xs text-slate-700">
                {recoveryCodes.map((rc) => (
                  <span key={rc} className="text-center tracking-wide">{rc}</span>
                ))}
              </div>
              <button type="button" onClick={finishEnroll} className={primaryBtn}>
                I've saved these — continue
              </button>
            </>
          ) : (
            <form
              className="space-y-4"
              onSubmit={(e) => {
                e.preventDefault()
                void confirmEnroll()
              }}
            >
              <p className="text-sm text-slate-600">
                Scan this QR code with an authenticator app (Google Authenticator, Authy, 1Password), then
                enter the 6-digit code it shows.
              </p>
              {enroll && (
                <div className="flex flex-col items-center gap-3">
                  <div className="rounded-xl border border-slate-200 bg-white p-3">
                    <QRCodeSVG value={enroll.uri} size={168} />
                  </div>
                  <p className="break-all text-center font-mono text-[11px] text-slate-400">{enroll.secret}</p>
                </div>
              )}
              <input
                type="text"
                inputMode="numeric"
                autoComplete="one-time-code"
                placeholder="Enter 6-digit code"
                value={totpCode}
                maxLength={6}
                onChange={(e) => setTotpCode(e.target.value.replace(/\D/g, ''))}
                className={`${inputClass} text-center text-lg tracking-[0.4em]`}
              />
              {error && <p className="text-sm text-red-600">{error}</p>}
              <button type="submit" disabled={totpCode.trim().length < 6 || loading} className={primaryBtn}>
                {loading ? 'Verifying…' : 'Verify & enable'}
              </button>
            </form>
          )}
        </div>
      )}

      <p className="mt-6 text-center text-xs text-slate-400">
        Access is by invitation only. Ask your organization admin for an invite.
      </p>
    </AuthShell>
  )
}

function GoogleLoginButton() {
  const containerRef = useRef<HTMLDivElement>(null)
  const navigate = useNavigate()
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const inFlightRef = useRef(false)

  useEffect(() => {
    const el = containerRef.current
    if (!el || !import.meta.env.VITE_GOOGLE_CLIENT_ID) return

    return mountGoogleSignInButton(el, (idToken) => {
      if (inFlightRef.current) return
      inFlightRef.current = true
      setLoading(true)
      setError('')
      resetAuthClientState()
      void loginWithGoogle(idToken)
        .then((data) => {
          syncLoginWorkspaceStore(data.login_context)
          navigate(loginLandingPath(data.login_context), { replace: true })
        })
        .catch((err) => {
          setLoading(false)
          inFlightRef.current = false
          setError(errorMessage(err))
        })
    })
  }, [navigate])

  if (!import.meta.env.VITE_GOOGLE_CLIENT_ID) return null

  return (
    <div className={loading ? 'pointer-events-none opacity-60' : ''}>
      <div ref={containerRef} className="flex min-h-11 w-full justify-center" />
      {loading ? (
        <p className="mt-2 text-center text-xs text-slate-500">Signing in with Google…</p>
      ) : null}
      {error ? <p className="mt-2 text-center text-xs text-red-600">{error}</p> : null}
    </div>
  )
}
