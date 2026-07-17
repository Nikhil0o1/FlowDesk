import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { Route, Routes } from 'react-router-dom'

import { logout } from '@/lib/api'
import { mockUser } from '@tests/fixtures'
import { renderWithProviders } from '@tests/renderWithProviders'
import { useAuthStore } from '@/stores/auth'
import { useUIStore } from '@/stores/ui'
import AdminLayout from '@/layouts/AdminLayout'

vi.mock('@/lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api')>()
  return {
    ...actual,
    logout: vi.fn().mockResolvedValue(undefined),
  }
})

describe('AdminLayout', () => {
  beforeEach(() => {
    useUIStore.setState({ theme: 'dark' })
    useAuthStore.setState({
      user: { ...mockUser, is_platform_superadmin: true },
      loginContext: null,
      initialized: true,
      accessToken: 'test-token',
    })
    vi.mocked(logout).mockClear()
  })

  it('renders admin nav and outlet content', () => {
    renderWithProviders(
      <Routes>
        <Route path="/admin" element={<AdminLayout />}>
          <Route path="platform" element={<div>Platform content</div>} />
        </Route>
      </Routes>,
      { routerProps: { initialEntries: ['/admin/platform'] } },
    )

    expect(screen.getByText('FlowDesk Admin')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /Platform overview/i })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /Organizations/i })).toBeInTheDocument()
    expect(screen.getByText('Platform content')).toBeInTheDocument()
    expect(screen.getByText('Test User')).toBeInTheDocument()
    expect(screen.getByText('Superadmin')).toBeInTheDocument()
    expect(screen.getByTitle('Switch to light mode')).toBeInTheDocument()
  })

  it('toggles theme from the admin header', async () => {
    const user = userEvent.setup()
    renderWithProviders(
      <Routes>
        <Route path="/admin" element={<AdminLayout />}>
          <Route path="platform" element={<div>Platform</div>} />
        </Route>
      </Routes>,
      { routerProps: { initialEntries: ['/admin/platform'] } },
    )

    await user.click(screen.getByTitle('Switch to light mode'))
    expect(useUIStore.getState().theme).toBe('light')
    expect(screen.getByTitle('Switch to dark mode')).toBeInTheDocument()
  })

  it('logs out and navigates to login', async () => {
    const user = userEvent.setup()
    renderWithProviders(
      <Routes>
        <Route path="/admin" element={<AdminLayout />}>
          <Route path="platform" element={<div>Platform</div>} />
        </Route>
        <Route path="/login" element={<div>Login page</div>} />
      </Routes>,
      { routerProps: { initialEntries: ['/admin/platform'] } },
    )

    await user.click(screen.getByTitle('Log out'))
    expect(logout).toHaveBeenCalled()
    expect(await screen.findByText('Login page')).toBeInTheDocument()
  })
})
