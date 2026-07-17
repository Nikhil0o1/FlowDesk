import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { api } from '@/lib/api'
import { startGoogleConnect, useCalendarStatus } from '@/lib/googleCalendar'

vi.mock('@/stores/toast', () => ({
  toast: { error: vi.fn(), success: vi.fn(), info: vi.fn() },
}))

import { toast } from '@/stores/toast'

function wrapper() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  })
  return ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  )
}

describe('useCalendarStatus', () => {
  beforeEach(() => {
    vi.mocked(api.get).mockReset()
  })

  it('fetches calendar status from the API', async () => {
    const status = { connected: true, email: 'user@gmail.com' }
    vi.mocked(api.get).mockResolvedValue(status)
    const { result } = renderHook(() => useCalendarStatus(), { wrapper: wrapper() })
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(result.current.data).toEqual(status)
    expect(api.get).toHaveBeenCalledWith('/calendar/status')
  })
})

describe('startGoogleConnect', () => {
  beforeEach(() => {
    vi.mocked(api.get).mockReset()
    vi.mocked(toast.error).mockReset()
    Object.defineProperty(window, 'location', {
      value: { href: 'http://localhost/app/settings' },
      writable: true,
      configurable: true,
    })
  })

  it('redirects to the auth URL on success', async () => {
    vi.mocked(api.get).mockResolvedValue({ url: 'https://accounts.google.com/o/oauth2/auth' })
    await startGoogleConnect()
    expect(api.get).toHaveBeenCalledWith('/calendar/google/auth-url?tool=calendar')
    expect(window.location.href).toBe('https://accounts.google.com/o/oauth2/auth')
  })

  it('passes the requested tool to the auth URL', async () => {
    vi.mocked(api.get).mockResolvedValue({ url: 'https://accounts.google.com/o/oauth2/auth' })
    await startGoogleConnect('gmail')
    expect(api.get).toHaveBeenCalledWith('/calendar/google/auth-url?tool=gmail')
  })

  it('shows toast on API failure', async () => {
    vi.mocked(api.get).mockRejectedValue(new Error('offline'))
    await startGoogleConnect()
    expect(toast.error).toHaveBeenCalledWith('offline')
  })
})
