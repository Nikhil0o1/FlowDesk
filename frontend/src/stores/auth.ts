import { create } from 'zustand'

import type { User } from '../lib/types'

interface AuthState {
  accessToken: string | null
  user: User | null
  initialized: boolean
  setAuth: (token: string, user: User) => void
  setAccessToken: (token: string) => void
  setUser: (user: User) => void
  setInitialized: () => void
  clear: () => void
}

export const useAuthStore = create<AuthState>((set) => ({
  accessToken: null,
  user: null,
  initialized: false,
  setAuth: (accessToken, user) => set({ accessToken, user }),
  setAccessToken: (accessToken) => set({ accessToken }),
  setUser: (user) => set({ user }),
  setInitialized: () => set({ initialized: true }),
  clear: () => set({ accessToken: null, user: null }),
}))

export function displayName(user: User | null): string {
  if (!user) return ''
  return user.profile?.full_name || user.email
}
