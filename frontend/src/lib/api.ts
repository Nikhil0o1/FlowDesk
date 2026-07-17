import { useAuthStore, refreshStore, sessionHint } from '../stores/auth'
import { API_BASE, IS_CROSS_SITE_API } from './env'
import { queryClient } from './queryClient'
import type {
  Login2faEnrollResponse,
  LoginContext,
  MeResponse,
  OtpVerifyResponse,
  TokenResponse,
  Totp2faStatus,
  TotpSetupResponse,
} from './types'

export { API_ORIGIN } from './env'

const BASE = API_BASE

export class ApiError extends Error {
  status: number
  detail: unknown
  constructor(status: number, detail: unknown) {
    super(typeof detail === 'string' ? detail : 'Request failed')
    this.status = status
    this.detail = detail
  }
}

/** 'ok' = new access token; 'denied' = session truly invalid (401/403);
 * 'error' = transient (network down, server cold-starting) — keep the session. */
export type RefreshResult = 'ok' | 'denied' | 'error'

let refreshPromise: Promise<RefreshResult> | null = null

function persistRefreshToken(token?: string | null): void {
  if (token) refreshStore.set(token)
}

function refreshRequestInit(): RequestInit {
  const stored = refreshStore.get()
  const useBody = IS_CROSS_SITE_API && stored
  return {
    method: 'POST',
    credentials: 'include',
    headers: useBody ? { 'Content-Type': 'application/json' } : undefined,
    body: useBody ? JSON.stringify({ refresh_token: stored }) : undefined,
  }
}

/** Rotate the refresh cookie into a new access token. Single-flight. */
export async function tryRefresh(): Promise<RefreshResult> {
  if (!refreshPromise) {
    refreshPromise = (async (): Promise<RefreshResult> => {
      try {
        const res = await fetch(`${BASE}/auth/refresh`, refreshRequestInit())
        if (res.status === 401 || res.status === 403) {
          sessionHint.clear()
          refreshStore.clear()
          return 'denied'
        }
        if (!res.ok) return 'error'
        const data = (await res.json()) as { access_token: string; refresh_token?: string | null }
        persistRefreshToken(data.refresh_token)
        useAuthStore.getState().setAccessToken(data.access_token)
        return 'ok'
      } catch {
        return 'error'
      } finally {
        // allow the next refresh attempt after this settles
        setTimeout(() => {
          refreshPromise = null
        }, 0)
      }
    })()
  }
  return refreshPromise
}

async function request<T>(
  method: string,
  path: string,
  body?: unknown,
  opts: { retry?: boolean; formData?: FormData } = {},
): Promise<T> {
  const { accessToken } = useAuthStore.getState()
  const headers: Record<string, string> = {}
  if (accessToken) headers['Authorization'] = `Bearer ${accessToken}`
  if (body !== undefined && !opts.formData) headers['Content-Type'] = 'application/json'

  const res = await fetch(`${BASE}${path}`, {
    method,
    headers,
    credentials: 'include',
    body: opts.formData ?? (body !== undefined ? JSON.stringify(body) : undefined),
  })

  if (res.status === 401 && opts.retry !== false) {
    const refreshed = await tryRefresh()
    if (refreshed === 'ok') return request<T>(method, path, body, { ...opts, retry: false })
    // Only log out when the server explicitly rejected the session — a network
    // blip or a cold-starting backend must not end the user's session.
    if (refreshed === 'denied') useAuthStore.getState().clear()
  }

  if (!res.ok) {
    let detail: unknown = res.statusText
    try {
      const data = await res.json()
      detail = data.detail ?? data
    } catch {
      /* not json */
    }
    throw new ApiError(res.status, detail)
  }
  if (res.status === 204) return undefined as T
  const contentType = res.headers.get('content-type') ?? ''
  if (!contentType.includes('application/json')) return (await res.blob()) as T
  return (await res.json()) as T
}

export const api = {
  get: <T>(path: string) => request<T>('GET', path),
  post: <T>(path: string, body?: unknown) => request<T>('POST', path, body),
  patch: <T>(path: string, body?: unknown) => request<T>('PATCH', path, body),
  put: <T>(path: string, body?: unknown) => request<T>('PUT', path, body),
  delete: <T>(path: string) => request<T>('DELETE', path),
  upload: <T>(path: string, formData: FormData) =>
    request<T>('POST', path, undefined, { formData }),
}

// ---- Auth flows (passwordless: SSO + email one-time code) ----

/** Request an email sign-in code. Always resolves (no account enumeration). */
export async function requestLoginOtp(email: string): Promise<void> {
  await request('POST', '/auth/otp/request', { email }, { retry: false })
}

/** Verify the email code. Establishes the session only when no 2FA is needed;
 * otherwise returns a challenge to drive the /auth/2fa/* step. */
export async function verifyLoginOtp(email: string, code: string): Promise<OtpVerifyResponse> {
  const data = await request<OtpVerifyResponse>('POST', '/auth/otp/verify', { email, code }, { retry: false })
  if (data.status === 'authenticated' && data.access_token && data.user && data.login_context) {
    persistRefreshToken(data.refresh_token)
    useAuthStore.getState().setAuth(data.access_token, data.user, data.login_context)
  }
  return data
}

/** Complete an enrolled user's login with a TOTP or recovery code. */
export async function verify2fa(challengeToken: string, code: string): Promise<TokenResponse> {
  const data = await request<TokenResponse>(
    'POST', '/auth/2fa/verify', { challenge_token: challengeToken, code }, { retry: false },
  )
  useAuthStore.getState().setAuth(data.access_token, data.user, data.login_context)
  persistRefreshToken(data.refresh_token)
  return data
}

/** Begin TOTP enrollment during an org-enforced login (challenge-authed). */
export function setup2faLogin(challengeToken: string): Promise<TotpSetupResponse> {
  return request<TotpSetupResponse>('POST', '/auth/2fa/setup', { challenge_token: challengeToken }, { retry: false })
}

/** Finish org-enforced enrollment at login: activates 2FA and issues the session. */
export async function confirm2faLogin(challengeToken: string, code: string): Promise<Login2faEnrollResponse> {
  const data = await request<Login2faEnrollResponse>(
    'POST', '/auth/2fa/confirm', { challenge_token: challengeToken, code }, { retry: false },
  )
  useAuthStore.getState().setAuth(data.access_token, data.user, data.login_context)
  persistRefreshToken(data.refresh_token)
  return data
}

// ---- 2FA management (Settings; session-authed) ----

export function get2faStatus(): Promise<Totp2faStatus> {
  return api.get<Totp2faStatus>('/users/me/2fa')
}

export function setup2fa(): Promise<TotpSetupResponse> {
  return api.post<TotpSetupResponse>('/users/me/2fa/setup')
}

export function confirm2fa(code: string): Promise<{ recovery_codes: string[] }> {
  return api.post<{ recovery_codes: string[] }>('/users/me/2fa/confirm', { code })
}

export function disable2fa(): Promise<{ detail: string }> {
  return api.delete<{ detail: string }>('/users/me/2fa')
}

export async function loginWithGoogle(idToken: string): Promise<TokenResponse> {
  const credential = idToken.trim()
  if (!credential) throw new ApiError(400, 'Google sign-in did not return a credential')

  const data = await request<TokenResponse>(
    'POST',
    '/auth/google',
    { id_token: credential },
    { retry: false },
  )
  useAuthStore.getState().setAuth(data.access_token, data.user, data.login_context)
  persistRefreshToken(data.refresh_token)
  return data
}

export async function loginWithMicrosoft(idToken: string): Promise<TokenResponse> {
  const data = await request<TokenResponse>('POST', '/auth/microsoft', { id_token: idToken }, { retry: false })
  useAuthStore.getState().setAuth(data.access_token, data.user, data.login_context)
  persistRefreshToken(data.refresh_token)
  return data
}

export async function activateInvite(token: string, fullName: string): Promise<TokenResponse> {
  const data = await request<TokenResponse>(
    'POST',
    '/auth/activate-invite',
    { token, full_name: fullName },
    { retry: false },
  )
  useAuthStore.getState().setAuth(data.access_token, data.user, data.login_context)
  persistRefreshToken(data.refresh_token)
  return data
}

export async function logout(): Promise<void> {
  const stored = refreshStore.get()
  // Best-effort: close the presence session so analytics marks the user offline
  // immediately rather than waiting for the heartbeat to time out.
  try {
    await request('POST', '/presence/logout', undefined, { retry: false })
  } catch {
    /* presence is non-critical to logout */
  }
  try {
    await request(
      'POST',
      '/auth/logout',
      IS_CROSS_SITE_API && stored ? { refresh_token: stored } : undefined,
      { retry: false },
    )
  } finally {
    useAuthStore.getState().clear()
    // Drop personal caches so the next login never sees another user's data.
    queryClient.clear()
  }
}

/** On app boot: try cookie-based refresh, then load /auth/me.
 * Retries transient failures so a cold-starting backend doesn't bounce a
 * logged-in user to the login page. */
export async function bootstrapSession(opts: { skip?: boolean } = {}): Promise<boolean> {
  if (opts.skip) {
    useAuthStore.getState().setInitialized()
    return false
  }
  const { user, accessToken } = useAuthStore.getState()
  if (user && accessToken) {
    useAuthStore.getState().setInitialized()
    return true
  }
  if (!sessionHint.exists()) {
    useAuthStore.getState().setInitialized()
    return false
  }
  let result = await tryRefresh()
  for (const delay of [1500, 4000]) {
    if (result !== 'error') break
    await new Promise((r) => setTimeout(r, delay))
    result = await tryRefresh()
  }
  if (result !== 'ok') {
    useAuthStore.getState().setInitialized()
    return false
  }
  try {
    const me = await request<MeResponse>('GET', '/auth/me')
    useAuthStore.getState().setAuth(
      useAuthStore.getState().accessToken!,
      me.user,
      me.login_context,
    )
    return true
  } catch (err) {
    if (err instanceof ApiError && (err.status === 403 || err.status === 401)) {
      useAuthStore.getState().clear()
    }
    return false
  } finally {
    useAuthStore.getState().setInitialized()
  }
}

/** Called by GoogleCompletePage after the server-side OAuth redirect lands.
 *  Establishes the session without rotating the refresh token (avoids Brave race). */
export async function completeOAuthLogin(): Promise<boolean> {
  sessionHint.set()
  try {
    const stored = refreshStore.get()
    const res = await fetch(`${BASE}/auth/session/establish`, {
      method: 'POST',
      credentials: 'include',
      headers: IS_CROSS_SITE_API && stored ? { 'Content-Type': 'application/json' } : undefined,
      body: IS_CROSS_SITE_API && stored ? JSON.stringify({ refresh_token: stored }) : undefined,
    })
    if (!res.ok) {
      sessionHint.clear()
      refreshStore.clear()
      return false
    }
    const data = (await res.json()) as TokenResponse
    persistRefreshToken(data.refresh_token)
    useAuthStore.getState().setAuth(data.access_token, data.user, data.login_context)
    return true
  } catch {
    sessionHint.clear()
    refreshStore.clear()
    return false
  }
}

export function errorMessage(err: unknown): string {
  if (err instanceof ApiError) {
    if (typeof err.detail === 'string') return err.detail
    if (Array.isArray(err.detail)) {
      const first = err.detail[0] as { msg?: string } | undefined
      if (first?.msg) return first.msg
    }
    return 'Something went wrong'
  }
  if (err instanceof Error) return err.message
  return 'Something went wrong'
}
