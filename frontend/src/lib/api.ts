import { useAuthStore } from '../stores/auth'
import type { TokenResponse } from './types'

const BASE = '/api/v1'

export class ApiError extends Error {
  status: number
  detail: unknown
  constructor(status: number, detail: unknown) {
    super(typeof detail === 'string' ? detail : 'Request failed')
    this.status = status
    this.detail = detail
  }
}

let refreshPromise: Promise<boolean> | null = null

/** Rotate the refresh cookie into a new access token. Single-flight. */
export async function tryRefresh(): Promise<boolean> {
  if (!refreshPromise) {
    refreshPromise = (async () => {
      try {
        const res = await fetch(`${BASE}/auth/refresh`, {
          method: 'POST',
          credentials: 'include',
        })
        if (!res.ok) return false
        const data = (await res.json()) as { access_token: string }
        useAuthStore.getState().setAccessToken(data.access_token)
        return true
      } catch {
        return false
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
    if (refreshed) return request<T>(method, path, body, { ...opts, retry: false })
    useAuthStore.getState().clear()
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

/** On app boot: try cookie-based refresh, then load /auth/me. */
export async function bootstrapSession(): Promise<boolean> {
  const ok = await tryRefresh()
  if (!ok) {
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
