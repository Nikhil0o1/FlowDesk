import { screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { Route, Routes } from 'react-router-dom'

import { mockCurrentContext, mockLoginContext, mockUser } from '@tests/fixtures'
import { renderWithProviders } from '@tests/renderWithProviders'
import { useAuthStore } from '@/stores/auth'
import AppLayout from '@/layouts/AppLayout'

vi.mock('@/layouts/Topbar', () => ({
  Topbar: () => <div data-testid="topbar">Topbar</div>,
}))

vi.mock('@/layouts/IconRail', () => ({
  IconRail: () => <div data-testid="icon-rail">IconRail</div>,
}))

vi.mock('@/layouts/SectionSidebar', () => ({
  SectionSidebar: ({ section }: { section: string }) => (
    <div data-testid="section-sidebar">Section: {section}</div>
  ),
  sectionFromPath: () => 'home',
}))

vi.mock('@/components/invites/InviteModal', () => ({
  InviteModal: () => null,
}))

vi.mock('@/lib/githubOAuth', () => ({
  useGithubOAuthCallback: vi.fn(),
}))

vi.mock('@/lib/taskDeletion', () => ({
  useDeletedTaskCleanup: vi.fn(),
}))

describe('AppLayout', () => {
  beforeEach(() => {
    useAuthStore.setState({
      user: mockUser,
      loginContext: mockLoginContext,
      initialized: true,
      accessToken: 'test-token',
    })
  })

  it('renders layout chrome with nested outlet for authenticated user', () => {
    renderWithProviders(
      <Routes>
        <Route path="/app" element={<AppLayout />}>
          <Route path="dashboard" element={<div>Dashboard content</div>} />
        </Route>
      </Routes>,
      { routerProps: { initialEntries: ['/app/dashboard'] } },
    )

    expect(screen.getByTestId('topbar')).toBeInTheDocument()
    expect(screen.getByTestId('icon-rail')).toBeInTheDocument()
    expect(screen.getByTestId('section-sidebar')).toBeInTheDocument()
    expect(screen.getByText('Dashboard content')).toBeInTheDocument()
    expect(useAuthStore.getState().user?.email).toBe('test@example.com')
  })
})
