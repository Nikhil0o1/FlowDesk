import { screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { get2faStatus } from '@/lib/api'
import { mockCurrentContext, mockUser } from '@tests/fixtures'
import { renderWithProviders } from '@tests/renderWithProviders'
import { useAuthStore } from '@/stores/auth'
import SettingsPage from '@/pages/app/SettingsPage'

vi.mock('qrcode.react', () => ({
  QRCodeSVG: () => <div data-testid="qr-code" />,
}))

vi.mock('@/lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api')>()
  return {
    ...actual,
    get2faStatus: vi.fn(),
  }
})

describe('SettingsPage', () => {
  beforeEach(() => {
    useAuthStore.setState({
      user: mockUser,
      loginContext: null,
      initialized: true,
      accessToken: 'token',
    })
    vi.mocked(get2faStatus).mockResolvedValue({
      enrolled: false,
      org_required: false,
      recovery_codes_remaining: 0,
    })
  })

  it('renders settings heading and profile tab', async () => {
    renderWithProviders(<SettingsPage />)

    expect(screen.getByRole('heading', { name: 'Settings' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Profile/i })).toBeInTheDocument()
    expect(await screen.findByDisplayValue('Test User')).toBeInTheDocument()
  })

  it('shows security tab content when selected', async () => {
    renderWithProviders(<SettingsPage />, {
      routerProps: { initialEntries: ['/app/settings?tab=security'] },
    })

    expect(await screen.findByText(/Two-factor authentication/i)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Enable 2FA' })).toBeInTheDocument()
  })

  it('shows API Keys tab in navigation', async () => {
    renderWithProviders(<SettingsPage />)
    expect(screen.getByRole('button', { name: /API Keys/i })).toBeInTheDocument()
  })
})