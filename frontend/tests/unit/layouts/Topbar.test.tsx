import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { mockCurrentContext, mockUser } from '@tests/fixtures'
import { mockTimeEntry } from '@tests/mockData'
import { renderWithProviders } from '@tests/renderWithProviders'
import { useAuthStore } from '@/stores/auth'
import { useUIStore } from '@/stores/ui'
import { useCurrentContext, useRunningTimer, useUnreadNotifications } from '@/lib/queries'
import { Topbar } from '@/layouts/Topbar'

vi.mock('@/lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api')>()
  return {
    ...actual,
    logout: vi.fn().mockResolvedValue(undefined),
  }
})

describe('Topbar', () => {
  beforeEach(() => {
    useAuthStore.setState({
      user: mockUser,
      loginContext: null,
      initialized: true,
      accessToken: 'test-token',
    })
    useUIStore.setState({
      searchOpen: false,
      setSearchOpen: vi.fn(),
      notificationsMuted: false,
      toggleNotificationsMuted: vi.fn(),
      theme: 'dark',
      toggleTheme: vi.fn(),
    })
    vi.mocked(useCurrentContext).mockReturnValue(mockCurrentContext())
    vi.mocked(useUnreadNotifications).mockReturnValue({
      data: { count: 3 },
      isLoading: false,
    } as ReturnType<typeof useUnreadNotifications>)
    vi.mocked(useRunningTimer).mockReturnValue({
      data: null,
      isLoading: false,
    } as ReturnType<typeof useRunningTimer>)
  })

  it('renders workspace name', () => {
    renderWithProviders(<Topbar />)
    expect(screen.getByText('Main Workspace')).toBeInTheDocument()
  })

  it('shows running timer when active', () => {
    vi.mocked(useRunningTimer).mockReturnValue({
      data: mockTimeEntry({ ended_at: null, duration_seconds: null }),
      isLoading: false,
    } as ReturnType<typeof useRunningTimer>)
    renderWithProviders(<Topbar />)
    expect(screen.getByTitle('Stop timer')).toBeInTheDocument()
  })

  it('opens search command', async () => {
    const setSearchOpen = vi.fn()
    useUIStore.setState({ setSearchOpen })
    const user = userEvent.setup()
    renderWithProviders(<Topbar />)
    await user.click(screen.getByRole('button', { name: /Search/i }))
    expect(setSearchOpen).toHaveBeenCalledWith(true)
  })

  it('toggles theme from header', async () => {
    const toggleTheme = vi.fn()
    useUIStore.setState({ toggleTheme })
    const user = userEvent.setup()
    renderWithProviders(<Topbar />)
    await user.click(screen.getByTitle('Switch to light mode'))
    expect(toggleTheme).toHaveBeenCalled()
  })

  it('switches workspace from dropdown', async () => {
    const user = userEvent.setup()
    renderWithProviders(<Topbar />)
    await user.click(screen.getByText('Main Workspace'))
    expect(await screen.findByText(/Acme Corp — Workspaces/i)).toBeInTheDocument()
  })
})
