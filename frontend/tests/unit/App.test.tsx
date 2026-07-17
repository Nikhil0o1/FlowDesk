import { screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { mockCurrentContext, mockLoginContext, mockOrg, mockUser, mockWorkspace } from '@tests/fixtures'
import { renderWithProviders } from '@tests/renderWithProviders'
import { useAuthStore } from '@/stores/auth'
import { api } from '@/lib/api'
import App from '@/App'

describe('App', () => {
  beforeEach(() => {
    useAuthStore.setState({
      user: mockUser,
      loginContext: mockLoginContext,
      initialized: true,
      accessToken: 'test-token',
    })
    vi.mocked(api.get).mockImplementation(async (url: string) => {
      if (url.includes('/task-stats')) return { total: 0, by_status: [] }
      if (url === '/organizations') return [mockOrg]
      if (url.includes('/workspaces') && !url.includes('/task-stats')) return [mockWorkspace]
      if (url.includes('/integrations/google/status')) return { configured: false, connected: false }
      if (url.includes('/notifications/unread-count')) return { count: 0 }
      if (url === '/timer/current') return null
      if (url.includes('/projects')) return []
      if (url.includes('/spaces')) return []
      return {}
    })
  })

  it('renders authenticated dashboard route', async () => {
    renderWithProviders(<App />, {
      routerProps: { initialEntries: ['/app/dashboard'] },
    })

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'Main Workspace' })).toBeInTheDocument()
    }, { timeout: 10000 })
    expect(screen.getAllByText('Overview').length).toBeGreaterThan(0)
  })

  it('redirects unauthenticated users to login', async () => {
    useAuthStore.setState({
      user: null,
      loginContext: null,
      initialized: true,
      accessToken: null,
    })

    renderWithProviders(<App />, {
      routerProps: { initialEntries: ['/app/dashboard'] },
    })

    expect(await screen.findByRole('heading', { name: 'Welcome back!' }, { timeout: 10000 })).toBeInTheDocument()
  }, 15000)
})
