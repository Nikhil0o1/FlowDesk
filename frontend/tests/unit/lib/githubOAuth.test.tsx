import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { renderHook, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { api } from '@/lib/api'
import { githubOAuthReturnPath, startGithubOAuth, useGithubOAuthCallback } from '@/lib/githubOAuth'

vi.mock('@/stores/toast', () => ({
  toast: { error: vi.fn(), success: vi.fn(), info: vi.fn() },
}))

import { toast } from '@/stores/toast'

describe('githubOAuthReturnPath', () => {
  it('returns relative app path with query string', () => {
    Object.defineProperty(window, 'location', {
      value: { pathname: '/app/projects/p1', search: '?tab=repos' },
      writable: true,
      configurable: true,
    })
    expect(githubOAuthReturnPath()).toBe('projects/p1?tab=repos')
  })

  it('falls back when not under /app', () => {
    Object.defineProperty(window, 'location', {
      value: { pathname: '/login', search: '' },
      writable: true,
      configurable: true,
    })
    expect(githubOAuthReturnPath()).toBe('apps?app=github')
  })

  it('defaults to apps when /app path has no remainder', () => {
    Object.defineProperty(window, 'location', {
      value: { pathname: '/app/', search: '' },
      writable: true,
      configurable: true,
    })
    expect(githubOAuthReturnPath()).toBe('apps?app=github')
  })
})

describe('startGithubOAuth', () => {
  beforeEach(() => {
    vi.mocked(api.get).mockReset()
    vi.mocked(toast.error).mockReset()
    Object.defineProperty(window, 'location', {
      value: { pathname: '/app/settings', search: '', href: 'http://localhost/app/settings' },
      writable: true,
      configurable: true,
    })
  })

  it('redirects to safe GitHub OAuth URL for personal connect', async () => {
    vi.mocked(api.get).mockResolvedValue({
      url: 'https://github.com/login/oauth/authorize?client_id=abc',
    })
    await startGithubOAuth({ type: 'personal', orgId: 'org-1' })
    expect(api.get).toHaveBeenCalledWith(
      expect.stringContaining('type=personal&org_id=org-1'),
    )
    expect(window.location.href).toBe('https://github.com/login/oauth/authorize?client_id=abc')
  })

  it('builds project OAuth query params', async () => {
    vi.mocked(api.get).mockResolvedValue({
      url: 'https://github.com/login/oauth/authorize?client_id=abc',
    })
    await startGithubOAuth({ type: 'project', projectId: 'proj-9' })
    expect(api.get).toHaveBeenCalledWith(
      expect.stringContaining('type=project&project_id=proj-9'),
    )
  })

  it('rejects unsafe authorization URLs', async () => {
    vi.mocked(api.get).mockResolvedValue({ url: 'https://evil.com/oauth' })
    await startGithubOAuth({ type: 'personal', orgId: 'org-1' })
    expect(toast.error).toHaveBeenCalledWith('Invalid authorization URL from server')
  })

  it('shows toast on API failure', async () => {
    vi.mocked(api.get).mockRejectedValue(new Error('network'))
    await startGithubOAuth({ type: 'personal', orgId: 'org-1' })
    expect(toast.error).toHaveBeenCalledWith('network')
  })
})

describe('useGithubOAuthCallback', () => {
  function renderCallback(initialEntry: string) {
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false, gcTime: 0 } },
    })
    const invalidateSpy = vi.spyOn(client, 'invalidateQueries')
    const ui = () => {
      useGithubOAuthCallback()
      return null
    }
    renderHook(() => ui(), {
      wrapper: ({ children }) => (
        <QueryClientProvider client={client}>
          <MemoryRouter initialEntries={[initialEntry]}>
            <Routes>
              <Route path="/app/settings" element={children} />
            </Routes>
          </MemoryRouter>
        </QueryClientProvider>
      ),
    })
    return { client, invalidateSpy }
  }

  beforeEach(() => {
    vi.mocked(toast.success).mockReset()
    vi.mocked(toast.error).mockReset()
  })

  it('handles github_connected success', async () => {
    const { invalidateSpy } = renderCallback('/app/settings?github_connected=1')
    await waitFor(() => {
      expect(toast.success).toHaveBeenCalledWith('GitHub connected successfully!')
    })
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['gh-personal'] })
  })

  it('handles github_error failure', async () => {
    renderCallback('/app/settings?github_error=1')
    await waitFor(() => {
      expect(toast.error).toHaveBeenCalledWith('GitHub connection failed. Please try again.')
    })
  })
})
