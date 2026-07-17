import { beforeEach, describe, expect, it, vi } from 'vitest'

import { displayName, refreshStore, sessionHint, useAuthStore } from '@/stores/auth'
import type { LoginContext, User } from '@/lib/types'

const user: User = {
  id: 'u1',
  email: 'alice@example.com',
  is_active: true,
  is_platform_superadmin: false,
  auth_provider: 'password',
  last_login_at: null,
  created_at: '2026-01-01T00:00:00Z',
  totp_enabled: false,
  profile: {
    full_name: 'Alice Smith',
    avatar_url: null,
    avatar_color: null,
    status_text: null,
    title: null,
    timezone: 'UTC',
    phone: null,
    about: null,
  },
}

const loginContext: LoginContext = {
  kind: 'member',
  role: 'member',
  redirect_to: '/app/dashboard',
  organization_id: 'org-1',
  workspace_id: 'ws-1',
  project_id: null,
}

describe('useAuthStore', () => {
  it('starts uninitialized with no session', () => {
    useAuthStore.setState({
      accessToken: null,
      user: null,
      loginContext: null,
      initialized: false,
    })
    const state = useAuthStore.getState()
    expect(state.accessToken).toBeNull()
    expect(state.initialized).toBe(false)
  })

  it('setAuth stores token, user, and login context', () => {
    useAuthStore.getState().setAuth('token-1', user, loginContext)
    const state = useAuthStore.getState()
    expect(state.accessToken).toBe('token-1')
    expect(state.user).toEqual(user)
    expect(state.loginContext).toEqual(loginContext)
  })

  it('setAccessToken updates only the token', () => {
    useAuthStore.getState().setAuth('old', user, loginContext)
    useAuthStore.getState().setAccessToken('new')
    expect(useAuthStore.getState().accessToken).toBe('new')
    expect(useAuthStore.getState().user).toEqual(user)
  })

  it('setUser updates the user', () => {
    const updated = { ...user, email: 'new@example.com' }
    useAuthStore.getState().setUser(updated)
    expect(useAuthStore.getState().user?.email).toBe('new@example.com')
  })

  it('setInitialized marks the store ready', () => {
    useAuthStore.getState().setInitialized()
    expect(useAuthStore.getState().initialized).toBe(true)
  })

  it('clear wipes session state but keeps initialized flag', () => {
    useAuthStore.getState().setAuth('token', user, loginContext)
    useAuthStore.getState().setInitialized()
    useAuthStore.getState().clear()
    const state = useAuthStore.getState()
    expect(state.accessToken).toBeNull()
    expect(state.user).toBeNull()
    expect(state.loginContext).toBeNull()
    expect(state.initialized).toBe(true)
  })
})

describe('displayName', () => {
  it('prefers profile full_name', () => {
    expect(displayName(user)).toBe('Alice Smith')
  })

  it('falls back to email', () => {
    expect(displayName({ ...user, profile: null })).toBe('alice@example.com')
  })

  it('returns empty string for null user', () => {
    expect(displayName(null)).toBe('')
  })
})

describe('refreshStore', () => {
  beforeEach(() => {
    sessionStorage.clear()
  })

  it('persists and reads refresh tokens', () => {
    refreshStore.set('refresh-1')
    expect(refreshStore.get()).toBe('refresh-1')
    refreshStore.clear()
    expect(refreshStore.get()).toBeNull()
  })

  it('swallows storage errors', () => {
    const setItem = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('blocked')
    })
    const getItem = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked')
    })
    const removeItem = vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(() => {
      throw new Error('blocked')
    })

    expect(() => refreshStore.set('x')).not.toThrow()
    expect(refreshStore.get()).toBeNull()
    expect(() => refreshStore.clear()).not.toThrow()

    setItem.mockRestore()
    getItem.mockRestore()
    removeItem.mockRestore()
  })
})

describe('sessionHint', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  it('tracks whether a session hint exists', () => {
    expect(sessionHint.exists()).toBe(false)
    sessionHint.set()
    expect(sessionHint.exists()).toBe(true)
    sessionHint.clear()
    expect(sessionHint.exists()).toBe(false)
  })
})

describe('resetAuthClientState', () => {
  beforeEach(() => {
    localStorage.clear()
    sessionStorage.clear()
    useAuthStore.setState({
      accessToken: 'token',
      user,
      loginContext,
      initialized: true,
    })
  })

  it('clears persisted auth markers before SSO', async () => {
    sessionHint.set()
    refreshStore.set('refresh-token')

    const { resetAuthClientState } = await import('@/lib/googleAuth')
    resetAuthClientState()

    expect(useAuthStore.getState().accessToken).toBeNull()
    expect(sessionHint.exists()).toBe(false)
    expect(refreshStore.get()).toBeNull()
  })
})
