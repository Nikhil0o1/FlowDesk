import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { api } from '@/lib/api'
import { mockLoginContext, mockUser } from '@tests/fixtures'
import { renderWithProviders } from '@tests/renderWithProviders'
import { useAuthStore } from '@/stores/auth'
import ActivateInvitePage from '@/pages/auth/ActivateInvitePage'

const readAuthTokenFromUrl = vi.fn()
const navigate = vi.fn()

vi.mock('@/lib/fragmentToken', () => ({
  readAuthTokenFromUrl: (...args: unknown[]) => readAuthTokenFromUrl(...args),
}))

vi.mock('react-router-dom', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-router-dom')>()
  return {
    ...actual,
    useNavigate: () => navigate,
  }
})

describe('ActivateInvitePage', () => {
  beforeEach(() => {
    readAuthTokenFromUrl.mockReset()
    navigate.mockReset()
    vi.mocked(api.post).mockReset()
    vi.mocked(api.get).mockReset()
  })

  it('shows invalid invitation when token and invite id are missing', () => {
    readAuthTokenFromUrl.mockReturnValue(null)

    renderWithProviders(<ActivateInvitePage />, {
      routerProps: { initialEntries: ['/activate-invite'] },
    })

    expect(screen.getByRole('heading', { name: 'Invalid invitation' })).toBeInTheDocument()
  })

  it('shows new-user activation form when preview succeeds', async () => {
    readAuthTokenFromUrl.mockReturnValue('invite-token-abc')
    vi.mocked(api.post).mockResolvedValue({
      email: 'new@example.com',
      target_name: 'Main Workspace',
      scope: 'workspace',
      organization_name: 'Acme Corp',
      role: 'member',
      existing_user: false,
      expired: false,
    })

    renderWithProviders(<ActivateInvitePage />, {
      routerProps: { initialEntries: ['/activate-invite/invite-token-abc'] },
    })

    expect(await screen.findByRole('heading', { name: "You're invited to Main Workspace" })).toBeInTheDocument()
    expect(screen.getByPlaceholderText('Your full name')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Activate account' })).toBeDisabled()
  })

  it('shows org-owner welcome heading for new org owner activation', async () => {
    readAuthTokenFromUrl.mockReturnValue('invite-token-owner')
    vi.mocked(api.post).mockResolvedValue({
      email: 'owner@example.com',
      target_name: 'Brightcone',
      scope: 'organization',
      organization_name: 'Brightcone',
      role: 'owner',
      existing_user: false,
      expired: false,
    })

    renderWithProviders(<ActivateInvitePage />, {
      routerProps: { initialEntries: ['/activate-invite/invite-token-owner'] },
    })

    expect(await screen.findByRole('heading', { name: 'Welcome to FlowDesk.' })).toBeInTheDocument()
    expect(screen.getByPlaceholderText('Your full name')).toBeInTheDocument()
  })

  it('shows existing-user accept flow when preview marks existing_user', async () => {
    readAuthTokenFromUrl.mockReturnValue('invite-token-xyz')
    vi.mocked(api.post).mockResolvedValue({
      email: 'existing@example.com',
      target_name: 'Engineering',
      scope: 'workspace',
      organization_name: 'Acme Corp',
      role: 'admin',
      existing_user: true,
      expired: false,
    })

    renderWithProviders(<ActivateInvitePage />, {
      routerProps: { initialEntries: ['/activate-invite/invite-token-xyz'] },
    })

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'Join Engineering' })).toBeInTheDocument()
    })
    expect(screen.getByRole('link', { name: 'Sign in to accept' })).toBeInTheDocument()
  })

  it('shows expired invitation state', async () => {
    readAuthTokenFromUrl.mockReturnValue('expired-token')
    vi.mocked(api.post).mockResolvedValue({
      email: 'new@example.com',
      target_name: 'Main Workspace',
      scope: 'workspace',
      organization_name: 'Acme Corp',
      role: 'member',
      existing_user: false,
      expired: true,
    })

    renderWithProviders(<ActivateInvitePage />, {
      routerProps: { initialEntries: ['/activate-invite/expired-token'] },
    })

    expect(await screen.findByRole('heading', { name: 'Invitation unavailable' })).toBeInTheDocument()
  })

  it('activates a new user account and lands on home dashboard', async () => {
    const user = userEvent.setup()
    const { activateInvite: realActivate } = await vi.importActual<typeof import('@/lib/api')>(
      '@/lib/api',
    )
    const activateSpy = vi.spyOn(await import('@/lib/api'), 'activateInvite').mockResolvedValue({
      access_token: 'token',
      user: mockUser,
      login_context: {
        ...mockLoginContext,
        kind: 'org_owner',
        redirect_to: '/app/workspaces',
      },
    } as Awaited<ReturnType<typeof realActivate>>)

    readAuthTokenFromUrl.mockReturnValue('invite-token-new')
    vi.mocked(api.post).mockImplementation(async (url: string) => {
      if (url === '/auth/invite-preview') {
        return {
          email: 'new@example.com',
          target_name: 'Main Workspace',
          scope: 'workspace',
          organization_name: 'Acme Corp',
          role: 'member',
          existing_user: false,
          expired: false,
        }
      }
      return {}
    })

    renderWithProviders(<ActivateInvitePage />, {
      routerProps: { initialEntries: ['/activate-invite/invite-token-new'] },
    })

    await screen.findByRole('heading', { name: "You're invited to Main Workspace" })
    await user.type(screen.getByPlaceholderText('Your full name'), 'New User')
    await user.click(screen.getByRole('button', { name: 'Activate account' }))
    await waitFor(() => {
      expect(activateSpy).toHaveBeenCalledWith('invite-token-new', 'New User')
      expect(navigate).toHaveBeenCalledWith('/app/dashboard')
    })
    activateSpy.mockRestore()
  })

  it('accepts invite for a signed-in existing user', async () => {
    const user = userEvent.setup()
    useAuthStore.setState({ user: mockUser })
    readAuthTokenFromUrl.mockReturnValue('invite-existing')
    vi.mocked(api.post).mockImplementation(async (url: string) => {
      if (url === '/auth/invite-preview') {
        return {
          email: mockUser.email,
          target_name: 'Engineering',
          scope: 'workspace',
          organization_name: 'Acme Corp',
          role: 'admin',
          existing_user: true,
          expired: false,
        }
      }
      return {}
    })

    renderWithProviders(<ActivateInvitePage />, {
      routerProps: { initialEntries: ['/activate-invite/invite-existing'] },
    })

    await user.click(await screen.findByRole('button', { name: 'Accept invitation' }))
    expect(api.post).toHaveBeenCalledWith('/auth/accept-invite', { token: 'invite-existing' })
  })
})
