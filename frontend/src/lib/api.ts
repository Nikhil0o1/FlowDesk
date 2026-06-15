import { useAuthStore } from '../stores/auth'
import type { TokenResponse } from './types'

// Dev: same-origin '/api' (Vite proxies to :8000). Production (Vercel ↔ Render):
// set VITE_API_URL to the API origin, e.g. https://flowdesk-api.onrender.com
export const API_ORIGIN = ((import.meta.env.VITE_API_URL as string | undefined) ?? '').replace(/\/+$/, '')
const BASE = `${API_ORIGIN}/api/v1`

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

/** Rotate the refresh cookie into a new access token. Single-flight. */
export async function tryRefresh(): Promise<RefreshResult> {
  if (!refreshPromise) {
    refreshPromise = (async (): Promise<RefreshResult> => {
      try {
        const res = await fetch(`${BASE}/auth/refresh`, {
          method: 'POST',
          credentials: 'include',
        })
        if (res.status === 401 || res.status === 403) return 'denied'
        if (!res.ok) return 'error'
        const data = (await res.json()) as { access_token: string }
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
  delete: <T>(path: string) => request<T>('DELETE', path),
  upload: <T>(path: string, formData: FormData) =>
    request<T>('POST', path, undefined, { formData }),
}

// ---- Auth flows ----

export async function login(email: string, password: string): Promise<TokenResponse> {
  const data = await request<TokenResponse>('POST', '/auth/login', { email, password }, { retry: false })
  useAuthStore.getState().setAuth(data.access_token, data.user)
  return data
}

export async function loginWithGoogle(idToken: string): Promise<TokenResponse> {
  const data = await request<TokenResponse>('POST', '/auth/google', { id_token: idToken }, { retry: false })
  useAuthStore.getState().setAuth(data.access_token, data.user)
  return data
}

export async function activateInvite(
  token: string,
  fullName: string,
  password: string,
): Promise<TokenResponse> {
  const data = await request<TokenResponse>(
    'POST',
    '/auth/activate-invite',
    { token, full_name: fullName, password },
    { retry: false },
  )
  useAuthStore.getState().setAuth(data.access_token, data.user)
  return data
}

export async function logout(): Promise<void> {
  try {
    await request('POST', '/auth/logout', undefined, { retry: false })
  } finally {
    useAuthStore.getState().clear()
  }
}

/** On app boot: try cookie-based refresh, then load /auth/me.
 * Retries transient failures so a cold-starting backend doesn't bounce a
 * logged-in user to the login page. */
export async function bootstrapSession(): Promise<boolean> {
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
    const me = await request<TokenResponse['user']>('GET', '/auth/me')
    useAuthStore.getState().setUser(me)
    return true
  } catch {
    return false
  } finally {
    useAuthStore.getState().setInitialized()
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
