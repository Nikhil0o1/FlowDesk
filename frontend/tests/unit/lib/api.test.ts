import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { mockLoginContext, mockUser } from '@tests/fixtures'

const setAccessToken = vi.fn()
const setAuth = vi.fn()
const clearAuth = vi.fn()
const setInitialized = vi.fn()

vi.mock('@/stores/auth', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/stores/auth')>()
  return {
    ...actual,
    useAuthStore: {
      getState: () => ({
        setAccessToken,
        setAuth,
        clear: clearAuth,
        setUser: vi.fn(),
        setInitialized,
        accessToken: 'existing-token',
        user: null,
        loginContext: null,
        initialized: false,
      }),
    },
  }
})

import {
  ApiError,
  api,
  bootstrapSession,
  completeOAuthLogin,
  errorMessage,
  loginWithGoogle,
  logout,
  requestLoginOtp,
  tryRefresh,
  verifyLoginOtp,
} from '@/lib/api'

describe('ApiError', () => {
  it('uses string detail as message', () => {
    const err = new ApiError(400, 'Bad request')
    expect(err.message).toBe('Bad request')
    expect(err.status).toBe(400)
  })
})

describe('errorMessage', () => {
  it('returns ApiError string detail', () => {
    expect(errorMessage(new ApiError(422, 'Invalid email'))).toBe('Invalid email')
  })

  it('returns first validation message from array detail', () => {
    expect(errorMessage(new ApiError(422, [{ msg: 'Field required' }]))).toBe('Field required')
  })

  it('falls back for generic errors', () => {
    expect(errorMessage(new Error('network down'))).toBe('network down')
    expect(errorMessage(null)).toBe('Something went wrong')
  })

  it('falls back when ApiError detail array has no message', () => {
    expect(errorMessage(new ApiError(422, [{}]))).toBe('Something went wrong')
  })
})

describe('tryRefresh', () => {
  beforeEach(async () => {
    vi.stubGlobal('fetch', vi.fn())
    setAccessToken.mockClear()
    await new Promise((r) => setTimeout(r, 20))
  })

  afterEach(async () => {
    vi.unstubAllGlobals()
    await new Promise((r) => setTimeout(r, 10))
  })

  it('returns denied on 401', async () => {
    vi.mocked(fetch).mockResolvedValue(new Response('', { status: 401 }))
    await expect(tryRefresh()).resolves.toBe('denied')
  })

  it('returns ok and stores token on success', async () => {
    vi.mocked(fetch).mockResolvedValue(
      new Response(JSON.stringify({ access_token: 'new-token' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    )
    const result = await tryRefresh()
    expect(result).toBe('ok')
    expect(setAccessToken).toHaveBeenCalledWith('new-token')
  })

  it('returns error on network failure', async () => {
    vi.mocked(fetch).mockRejectedValue(new Error('offline'))
    await expect(tryRefresh()).resolves.toBe('error')
  })
})

describe('api HTTP helpers', () => {
  beforeEach(async () => {
    vi.stubGlobal('fetch', vi.fn())
    setAccessToken.mockClear()
    setAuth.mockClear()
    clearAuth.mockClear()
    setInitialized.mockClear()
    await new Promise((r) => setTimeout(r, 20))
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('retries once after refresh on 401', async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(new Response('nope', { status: 401 }))
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ access_token: 'fresh' }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ ok: true }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      )

    const data = await api.get<{ ok: boolean }>('/widgets')
    expect(data).toEqual({ ok: true })
    expect(setAccessToken).toHaveBeenCalledWith('fresh')
  })

  it('clears session when refresh is denied', async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(new Response('nope', { status: 401 }))
      .mockResolvedValueOnce(new Response('', { status: 401 }))

    await expect(api.get('/widgets')).rejects.toThrow()
    expect(clearAuth).toHaveBeenCalled()
  })

  it('requestLoginOtp posts email without retry', async () => {
    vi.mocked(fetch).mockResolvedValue(new Response(null, { status: 204 }))
    await requestLoginOtp('user@example.com')
    expect(fetch).toHaveBeenCalledWith(
      expect.stringContaining('/auth/otp/request'),
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ email: 'user@example.com' }),
      }),
    )
  })

  it('verifyLoginOtp stores auth on authenticated response', async () => {
    vi.mocked(fetch).mockResolvedValue(
      new Response(
        JSON.stringify({
          status: 'authenticated',
          access_token: 'token',
          user: mockUser,
          login_context: mockLoginContext,
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    )
    const result = await verifyLoginOtp('user@example.com', '123456')
    expect(result.status).toBe('authenticated')
    expect(setAuth).toHaveBeenCalledWith('token', mockUser, mockLoginContext)
  })

  it('loginWithGoogle stores session', async () => {
    vi.mocked(fetch).mockResolvedValue(
      new Response(
        JSON.stringify({
          access_token: 'google-token',
          user: mockUser,
          login_context: mockLoginContext,
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    )
    await loginWithGoogle('google-id-token')
    expect(setAuth).toHaveBeenCalledWith('google-token', mockUser, mockLoginContext)
  })

  it('logout clears auth even when request fails', async () => {
    vi.mocked(fetch).mockRejectedValue(new Error('offline'))
    await expect(logout()).rejects.toThrow('offline')
    expect(clearAuth).toHaveBeenCalled()
  })

  it('bootstrapSession returns false when refresh fails', async () => {
    vi.mocked(fetch).mockResolvedValue(new Response('', { status: 401 }))
    const ok = await bootstrapSession()
    expect(ok).toBe(false)
    expect(setInitialized).toHaveBeenCalled()
  })

  it('completeOAuthLogin stores session on success', async () => {
    vi.mocked(fetch).mockResolvedValue(
      new Response(
        JSON.stringify({
          access_token: 'oauth-token',
          refresh_token: 'oauth-refresh',
          user: mockUser,
          login_context: mockLoginContext,
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    )
    await expect(completeOAuthLogin()).resolves.toBe(true)
    expect(setAuth).toHaveBeenCalledWith('oauth-token', mockUser, mockLoginContext)
  })

  it('completeOAuthLogin clears session markers on failure', async () => {
    vi.mocked(fetch).mockResolvedValue(new Response('', { status: 401 }))
    await expect(completeOAuthLogin()).resolves.toBe(false)
    expect(setAuth).not.toHaveBeenCalled()
  })

  it('completeOAuthLogin clears session markers on network error', async () => {
    vi.mocked(fetch).mockRejectedValue(new Error('offline'))
    await expect(completeOAuthLogin()).resolves.toBe(false)
    expect(setAuth).not.toHaveBeenCalled()
  })
})
