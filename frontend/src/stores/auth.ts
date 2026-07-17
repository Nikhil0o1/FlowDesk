import { create } from 'zustand'

import type { LoginContext, User } from '../lib/types'

interface AuthState {
  accessToken: string | null
  user: User | null
  loginContext: LoginContext | null
  initialized: boolean
  setAuth: (token: string, user: User, loginContext: LoginContext) => void
  setAccessToken: (token: string) => void
  setUser: (user: User) => void
  setInitialized: () => void
  clear: () => void
}

const SESSION_HINT = 'fd.session'
const REFRESH_STORE = 'fd.refresh'

export const refreshStore = {
  set: (token: string) => {
    try {
      sessionStorage.setItem(REFRESH_STORE, token)
    } catch {
      /* storage unavailable */
    }
  },
  get: (): string | null => {
    try {
      return sessionStorage.getItem(REFRESH_STORE)
    } catch {
      return null
    }
  },
  clear: () => {
    try {
      sessionStorage.removeItem(REFRESH_STORE)
    } catch {
      /* storage unavailable */
    }
  },
}

export const sessionHint = {
  set: () => localStorage.setItem(SESSION_HINT, '1'),
  clear: () => localStorage.removeItem(SESSION_HINT),
  exists: () => localStorage.getItem(SESSION_HINT) === '1',
}

export const useAuthStore = create<AuthState>((set) => ({
  accessToken: null,
  user: null,
  loginContext: null,
  initialized: false,
  setAuth: (accessToken, user, loginContext) => {
    sessionHint.set()
    set({ accessToken, user, loginContext })
  },
  setAccessToken: (accessToken) => set({ accessToken }),
  setUser: (user) => set({ user }),
  setInitialized: () => set({ initialized: true }),
  clear: () => {
    sessionHint.clear()
    refreshStore.clear()
    set({ accessToken: null, user: null, loginContext: null })
  },
}))

export function displayName(user: User | null): string {
  if (!user) return ''
  return user.profile?.full_name || user.email
}
