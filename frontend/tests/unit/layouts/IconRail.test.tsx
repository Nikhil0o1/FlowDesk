import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { mockCurrentContext, mockUser } from '@tests/fixtures'
import { renderWithProviders } from '@tests/renderWithProviders'
import { useAuthStore } from '@/stores/auth'
import { useUIStore } from '@/stores/ui'
import { useCurrentContext, useProjects, useSpaces, useUnreadNotifications } from '@/lib/queries'
import { IconRail } from '@/layouts/IconRail'

describe('IconRail', () => {
  beforeEach(() => {
    useAuthStore.setState({
      user: mockUser,
      loginContext: null,
      initialized: true,
      accessToken: 'test-token',
    })
    useUIStore.setState({
      sidebarCollapsed: false,
      toggleSidebar: vi.fn(),
      expandSidebar: vi.fn(),
      setFlyout: vi.fn(),
      scheduleFlyoutHide: vi.fn(),
      setInviteOpen: vi.fn(),
      notificationsMuted: false,
    })
    vi.mocked(useCurrentContext).mockReturnValue(mockCurrentContext())
    vi.mocked(useProjects).mockReturnValue({
      data: [],
      isLoading: false,
    } as ReturnType<typeof useProjects>)
    vi.mocked(useSpaces).mockReturnValue({
      data: [],
      isLoading: false,
    } as ReturnType<typeof useSpaces>)
    vi.mocked(useUnreadNotifications).mockReturnValue({
      data: { count: 2 },
      isLoading: false,
    } as ReturnType<typeof useUnreadNotifications>)
  })

  it('renders section icons and invite button for admins', () => {
    renderWithProviders(<IconRail />, {
      routerProps: { initialEntries: ['/app/dashboard'] },
    })
    expect(screen.getByText('Home')).toBeInTheDocument()
    expect(screen.getByText('Planner')).toBeInTheDocument()
    expect(screen.getByText('Teams')).toBeInTheDocument()
    expect(screen.getByText('Invite')).toBeInTheDocument()
  })

  it('shows invite button for space admins who are not workspace admins', () => {
    const memberWorkspace = { ...mockCurrentContext().workspace!, my_role: 'member' as const }
    vi.mocked(useCurrentContext).mockReturnValue(
      mockCurrentContext({
        org: { ...mockCurrentContext().org!, my_role: 'member' },
        workspace: memberWorkspace,
        workspaces: [memberWorkspace],
      }),
    )
    vi.mocked(useProjects).mockReturnValue({
      data: [{ id: 'p1', my_role: 'admin', workspace_id: 'ws-1', name: 'Alpha' }],
      isLoading: false,
    } as ReturnType<typeof useProjects>)
    vi.mocked(useSpaces).mockReturnValue({
      data: [{ id: 'sp-1', my_role: 'admin', workspace_id: 'ws-1', name: 'Sample Space' }],
      isLoading: false,
    } as ReturnType<typeof useSpaces>)
    renderWithProviders(<IconRail />)
    expect(screen.getByText('Invite')).toBeInTheDocument()
  })

  it('shows invite button for project admins who are not workspace admins', () => {
    const memberWorkspace = { ...mockCurrentContext().workspace!, my_role: 'member' as const }
    vi.mocked(useCurrentContext).mockReturnValue(
      mockCurrentContext({
        org: { ...mockCurrentContext().org!, my_role: 'member' },
        workspace: memberWorkspace,
        workspaces: [memberWorkspace],
      }),
    )
    vi.mocked(useProjects).mockReturnValue({
      data: [{ id: 'p1', my_role: 'member', my_explicit_role: 'admin', workspace_id: 'ws-1', name: 'Alpha' }],
      isLoading: false,
    } as ReturnType<typeof useProjects>)
    renderWithProviders(<IconRail />, {
      routerProps: { initialEntries: ['/app/dashboard'] },
    })
    expect(screen.getByText('Invite')).toBeInTheDocument()
  })

  it('hides invite button for members without project admin role', () => {
    const memberWorkspace = { ...mockCurrentContext().workspace!, my_role: 'member' as const }
    vi.mocked(useCurrentContext).mockReturnValue(
      mockCurrentContext({
        org: { ...mockCurrentContext().org!, my_role: 'member' },
        workspace: memberWorkspace,
        workspaces: [memberWorkspace],
      }),
    )
    vi.mocked(useProjects).mockReturnValue({
      data: [{ id: 'p1', my_role: 'member', workspace_id: 'ws-1', name: 'Alpha' }],
      isLoading: false,
    } as ReturnType<typeof useProjects>)
    renderWithProviders(<IconRail />)
    expect(screen.queryByText('Invite')).not.toBeInTheDocument()
  })

  it('shows expand control when sidebar is collapsed', async () => {
    useUIStore.setState({ sidebarCollapsed: true, toggleSidebar: vi.fn() })
    const user = userEvent.setup()
    renderWithProviders(<IconRail />)
    await user.click(screen.getByTitle('Expand sidebar'))
    expect(useUIStore.getState().toggleSidebar).toHaveBeenCalled()
  })
})
