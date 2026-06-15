import { Eye, EyeOff } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { Navigate, Link, useNavigate } from 'react-router-dom'

import { errorMessage, login, loginWithGoogle } from '../../lib/api'
import { useAuthStore } from '../../stores/auth'
import { AuthLogo, AuthShell, GoogleIcon } from './AuthShell'

const GOOGLE_CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID as string | undefined

declare global {
  interface Window {
    google?: any
  }
}

export default function LoginPage() {
  const navigate = useNavigate()
  const { user, initialized } = useAuthStore()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const googleBtnRef = useRef<HTMLDivElement>(null)
  const [googleReady, setGoogleReady] = useState(false)

  // Google Identity Services (renders only when a client id is configured)
  useEffect(() => {
    if (!GOOGLE_CLIENT_ID) return
    const script = document.createElement('script')
    script.src = 'https://accounts.google.com/gsi/client'
    script.async = true
    script.onload = () => {
      window.google?.accounts.id.initialize({
        client_id: GOOGLE_CLIENT_ID,
        callback: async (response: { credential: string }) => {
          try {
            setError('')
            await loginWithGoogle(response.credential)
            navigate('/app/dashboard')
          } catch (err) {
            setError(errorMessage(err))
          }
        },
      })
      setGoogleReady(true)
    }
    document.head.appendChild(script)
    return () => {
      script.remove()
    }
  }, [navigate])

  // Render Google's official button: unlike One Tap (`prompt()`), it opens a
  // sign-in popup that works even when the browser has no Google session.
  useEffect(() => {
    if (googleReady && googleBtnRef.current) {
      window.google?.accounts.id.renderButton(googleBtnRef.current, {
        theme: 'outline',
        size: 'large',
        text: 'continue_with',
        shape: 'rectangular',
        logo_alignment: 'center',
        width: 360,
      })
    }
  }, [googleReady])

  if (initialized && user) {
    return <Navigate to={user.is_platform_superadmin ? '/admin/platform' : '/app/dashboard'} replace />
  }

  const canSubmit = email.trim().length > 3 && password.length > 0 && !loading

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!canSubmit) return
    setLoading(true)
    setError('')
    try {
      const data = await login(email.trim(), password)
      navigate(data.user.is_platform_superadmin ? '/admin/platform' : '/app/dashboard')
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setLoading(false)
    }
  }

  const onGoogleClick = () => {
    if (!GOOGLE_CLIENT_ID) {
      setError('Google SSO is not configured. Set VITE_GOOGLE_CLIENT_ID and GOOGLE_CLIENT_ID.')
    }
    // Script still loading — the official Google button replaces this one
    // as soon as it's ready.
  }

  return (
    <AuthShell>
      <AuthLogo />
      <h1 className="text-2xl font-bold text-gray-900">Welcome back!</h1>
      <p className="mt-1 text-sm text-gray-500">Sign in to your workspace</p>

      <div className="mt-7 w-full space-y-3">
        {googleReady ? (
          <div ref={googleBtnRef} className="flex justify-center" />
        ) : (
          <GoogleLoginButton onClick={onGoogleClick} />
        )}
      </div>

      <div className="my-5 flex w-full items-center gap-3">
        <div className="h-px flex-1 bg-gray-300/70" />
        <span className="text-xs text-gray-400">or</span>
        <div className="h-px flex-1 bg-gray-300/70" />
      </div>

      <form onSubmit={onSubmit} className="w-full space-y-3">
        <input
          type="email"
          autoComplete="email"
          placeholder="Work email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className="w-full rounded-lg border border-gray-300 bg-white px-3.5 py-2.5 text-sm text-gray-900 outline-none transition-shadow placeholder:text-gray-400 focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
        />
        <div className="relative">
          <input
            type={showPassword ? 'text' : 'password'}
            autoComplete="current-password"
            placeholder="Password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="w-full rounded-lg border border-gray-300 bg-white px-3.5 py-2.5 pr-10 text-sm text-gray-900 outline-none transition-shadow placeholder:text-gray-400 focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
          />
          <button
            type="button"
            tabIndex={-1}
            onClick={() => setShowPassword((v) => !v)}
            className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
          >
            {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
          </button>
        </div>

        {error && <p className="text-sm text-red-600">{error}</p>}

        <button
          type="submit"
          disabled={!canSubmit}
          className="w-full rounded-lg bg-brand py-2.5 text-sm font-semibold text-white transition-colors hover:bg-brand-hover disabled:bg-gray-300 disabled:text-gray-500"
        >
          {loading ? 'Signing in…' : 'Log In'}
        </button>
      </form>

      <Link to="/forgot-password" className="mt-4 text-sm font-medium text-blue-600 hover:underline">
        Forgot Password?
      </Link>
      <p className="mt-6 text-xs text-gray-400">
        Access is by invitation only. Ask your organization admin for an invite.
      </p>
    </AuthShell>
  )
}

function GoogleLoginButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex w-full items-center justify-center gap-3 rounded-lg border border-gray-300 bg-white py-2.5 text-sm font-semibold text-gray-800 transition-colors hover:bg-gray-50"
    >
      <GoogleIcon />
      Continue with Google
    </button>
  )
}
