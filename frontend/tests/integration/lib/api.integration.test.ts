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

vi.mock('@/lib/api', async (importOriginal) => importOriginal())

import {
  activateInvite,
  api,
  bootstrapSession,
  confirm2fa,
  confirm2faLogin,
  disable2fa,
  get2faStatus,
  loginWithGoogle,
  loginWithMicrosoft,
  logout,
  requestLoginOtp,
  setup2fa,
  setup2faLogin,
  verify2fa,
  verifyLoginOtp,
} from '@/lib/api'

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

describe('api integration', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn())
    setAccessToken.mockClear()
    setAuth.mockClear()
    clearAuth.mockClear()
    setInitialized.mockClear()
  })

  afterEach(async () => {
    vi.unstubAllGlobals()
    await new Promise((r) => setTimeout(r, 20))
  })

  it('api.get returns JSON', async () => {
    vi.mocked(fetch).mockResolvedValue(jsonResponse({ ok: true }))
    await expect(api.get('/widgets')).resolves.toEqual({ ok: true })
  })

  it('api.post sends JSON body', async () => {
    vi.mocked(fetch).mockResolvedValue(jsonResponse({ id: '1' }))
    await api.post('/widgets', { name: 'A' })
    const [, init] = vi.mocked(fetch).mock.calls[0]
    expect(init?.body).toBe(JSON.stringify({ name: 'A' }))
  })

  it('api.delete handles 204', async () => {
    vi.mocked(fetch).mockResolvedValue(new Response(null, { status: 204 }))
    await expect(api.delete('/widgets/1')).resolves.toBeUndefined()
  })

  it('api.upload sends multipart form data', async () => {
    vi.mocked(fetch).mockResolvedValue(jsonResponse({ ok: true }))
    const form = new FormData()
    form.append('file', new Blob(['x']), 'a.txt')
    await api.upload('/upload', form)
    const [, init] = vi.mocked(fetch).mock.calls[0]
    expect(init?.body).toBeInstanceOf(FormData)
  })

  it('retries once after refresh on 401', async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(new Response('nope', { status: 401 }))
      .mockResolvedValueOnce(jsonResponse({ access_token: 'fresh' }))
      .mockResolvedValueOnce(jsonResponse({ ok: true }))

    await expect(api.get('/secure')).resolves.toEqual({ ok: true })
    expect(setAccessToken).toHaveBeenCalledWith('fresh')
  })

  it('clears session when refresh is denied', async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(new Response('nope', { status: 401 }))
      .mockResolvedValueOnce(new Response('', { status: 401 }))

    await expect(api.get('/secure')).rejects.toThrow()
    expect(clearAuth).toHaveBeenCalled()
  })

  it('requestLoginOtp posts email', async () => {
    vi.mocked(fetch).mockResolvedValue(jsonResponse({ ok: true }))
    await requestLoginOtp('user@example.com')
    expect(fetch).toHaveBeenCalledWith(
      expect.stringContaining('/auth/otp/request'),
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ email: 'user@example.com' }),
      }),
    )
  })

  it('verifyLoginOtp stores auth on success', async () => {
    vi.mocked(fetch).mockResolvedValue(
      jsonResponse({
        status: 'authenticated',
        access_token: 'token',
        user: mockUser,
        login_context: mockLoginContext,
      }),
    )
    const result = await verifyLoginOtp('user@example.com', '123456')
    expect(result.status).toBe('authenticated')
    expect(setAuth).toHaveBeenCalledWith('token', mockUser, mockLoginContext)
  })

  it('verify2fa and confirm2faLogin store session', async () => {
    const tokenPayload = {
      access_token: 'token',
      user: mockUser,
      login_context: mockLoginContext,
    }
    vi.mocked(fetch)
      .mockResolvedValueOnce(jsonResponse(tokenPayload))
      .mockResolvedValueOnce(
        jsonResponse({
          ...tokenPayload,
          recovery_codes: ['rc-1'],
        }),
      )

    await verify2fa('challenge', '123456')
    expect(setAuth).toHaveBeenCalledWith('token', mockUser, mockLoginContext)

    setAuth.mockClear()
    await confirm2faLogin('challenge', '654321')
    expect(setAuth).toHaveBeenCalled()
  })

  it('setup2faLogin returns setup payload', async () => {
    vi.mocked(fetch).mockResolvedValue(
      jsonResponse({ secret: 'SECRET', otpauth_uri: 'otpauth://totp/FlowDesk' }),
    )
    await expect(setup2faLogin('challenge')).resolves.toMatchObject({ secret: 'SECRET' })
  })

  it('SSO and invite flows store session', async () => {
    const tokenPayload = {
      access_token: 'sso-token',
      user: mockUser,
      login_context: mockLoginContext,
    }
    vi.mocked(fetch)
      .mockResolvedValueOnce(jsonResponse(tokenPayload))
      .mockResolvedValueOnce(jsonResponse(tokenPayload))
      .mockResolvedValueOnce(jsonResponse(tokenPayload))

    await loginWithGoogle('google-id')
    await loginWithMicrosoft('ms-id')
    await activateInvite('invite-token', 'New User')
    expect(setAuth).toHaveBeenCalledTimes(3)
  })

  it('logout clears auth even when request fails', async () => {
    vi.mocked(fetch).mockRejectedValue(new Error('offline'))
    await expect(logout()).rejects.toThrow('offline')
    expect(clearAuth).toHaveBeenCalled()
  })

  it('bootstrapSession succeeds after refresh', async () => {
    localStorage.setItem('fd.session', '1')
    vi.mocked(fetch)
      .mockResolvedValueOnce(jsonResponse({ access_token: 'tok' }))
      .mockResolvedValueOnce(jsonResponse({ user: mockUser, login_context: mockLoginContext }))

    await expect(bootstrapSession()).resolves.toBe(true)
    expect(setInitialized).toHaveBeenCalled()
  })

  it('bootstrapSession returns false when refresh fails', async () => {
    vi.mocked(fetch).mockResolvedValue(new Response('', { status: 401 }))
    await expect(bootstrapSession()).resolves.toBe(false)
    expect(setInitialized).toHaveBeenCalled()
  })

  it('2FA management endpoints call api', async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(jsonResponse({ enabled: true, confirmed_at: null }))
      .mockResolvedValueOnce(jsonResponse({ secret: 'S', otpauth_uri: 'otpauth://x' }))
      .mockResolvedValueOnce(jsonResponse({ recovery_codes: ['a'] }))
      .mockResolvedValueOnce(jsonResponse({ detail: 'disabled' }))

    await expect(get2faStatus()).resolves.toEqual({ enabled: true, confirmed_at: null })
    await expect(setup2fa()).resolves.toMatchObject({ secret: 'S' })
    await expect(confirm2fa('123456')).resolves.toEqual({ recovery_codes: ['a'] })
    await expect(disable2fa()).resolves.toEqual({ detail: 'disabled' })
  })
})
