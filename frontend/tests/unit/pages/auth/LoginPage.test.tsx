import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  confirm2faLogin,
  requestLoginOtp,
  setup2faLogin,
  verify2fa,
  verifyLoginOtp,
} from '@/lib/api'
import { mockLoginContext, mockUser } from '@tests/fixtures'
import { renderWithProviders } from '@tests/renderWithProviders'
import { useAuthStore } from '@/stores/auth'
import LoginPage from '@/pages/auth/LoginPage'

vi.mock('@/lib/msal', () => ({
  microsoftConfigured: false,
  microsoftLoginRedirect: vi.fn(),
}))

vi.mock('@/lib/googleAuth', () => ({
  mountGoogleSignInButton: (container: HTMLElement) => {
    const btn = document.createElement('button')
    btn.type = 'button'
    btn.textContent = 'Continue with Google'
    container.appendChild(btn)
    return () => {
      container.replaceChildren()
    }
  },
  resetAuthClientState: vi.fn(),
}))

vi.mock('@/lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api')>()
  return {
    ...actual,
    requestLoginOtp: vi.fn(),
    verifyLoginOtp: vi.fn(),
    setup2faLogin: vi.fn(),
    verify2fa: vi.fn(),
    confirm2faLogin: vi.fn(),
  }
})

vi.mock('qrcode.react', () => ({
  QRCodeSVG: () => <div data-testid="qr-code" />,
}))

describe('LoginPage', () => {
  beforeEach(() => {
    vi.stubEnv('VITE_GOOGLE_CLIENT_ID', 'test-google-client-id')
    useAuthStore.setState({
      user: null,
      loginContext: null,
      initialized: true,
      accessToken: null,
    })
    sessionStorage.clear()
    vi.mocked(requestLoginOtp).mockResolvedValue(undefined)
    vi.mocked(verifyLoginOtp).mockResolvedValue({
      status: 'authenticated',
      access_token: 'token',
      user: mockUser,
      login_context: mockLoginContext,
    } as Awaited<ReturnType<typeof verifyLoginOtp>>)
  })

  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('renders email sign-in step with SSO buttons', () => {
    renderWithProviders(<LoginPage />)

    expect(screen.getByRole('heading', { name: 'Welcome back!' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Continue with Google' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Continue with Microsoft' })).toBeInTheDocument()
    expect(screen.getByPlaceholderText('Work email')).toBeInTheDocument()
  })

  it('shows stored Microsoft login errors on mount', () => {
    sessionStorage.setItem('flowdesk.ms_login_error', 'Microsoft sign-in was cancelled')
    renderWithProviders(<LoginPage />)
    expect(screen.getByText('Microsoft sign-in was cancelled')).toBeInTheDocument()
    expect(sessionStorage.getItem('flowdesk.ms_login_error')).toBeNull()
  })

  it('shows Google redirect errors from the login URL', () => {
    window.history.replaceState(null, '', '/login?error=google_unauthorized')
    renderWithProviders(<LoginPage />, {
      routerProps: { initialEntries: ['/login?error=google_unauthorized'] },
    })
    expect(
      screen.getByText('You do not have permission to sign in. Access is by invitation only.'),
    ).toBeInTheDocument()
  })

  it('redirects authenticated users away from login', () => {
    useAuthStore.setState({
      user: mockUser,
      loginContext: mockLoginContext,
      initialized: true,
      accessToken: 'token',
    })

    renderWithProviders(<LoginPage />, {
      routerProps: { initialEntries: ['/login'] },
    })

    expect(screen.queryByRole('heading', { name: 'Welcome back!' })).not.toBeInTheDocument()
  })

  function emailForm() {
    return within(screen.getByPlaceholderText('Work email').closest('form')!)
  }

  it('advances to OTP step after email submit', async () => {
    const user = userEvent.setup()
    renderWithProviders(<LoginPage />)

    await user.type(screen.getByPlaceholderText('Work email'), 'test@example.com')
    await user.click(emailForm().getByRole('button', { name: /^Send sign-in code$/i }))
    await waitFor(() => {
      expect(requestLoginOtp).toHaveBeenCalledWith('test@example.com')
    })
    expect(await screen.findByPlaceholderText('Enter 6-digit code')).toBeInTheDocument()
  })

  it('verifies OTP and signs in', async () => {
    const user = userEvent.setup()
    renderWithProviders(<LoginPage />)

    await user.type(screen.getByPlaceholderText('Work email'), 'test@example.com')
    await user.click(emailForm().getByRole('button', { name: /^Send sign-in code$/i }))
    await screen.findByPlaceholderText('Enter 6-digit code')
    await user.type(screen.getByPlaceholderText('Enter 6-digit code'), '123456')
    await user.click(screen.getByRole('button', { name: /^Verify & sign in$/i }))
    await waitFor(() => {
      expect(verifyLoginOtp).toHaveBeenCalledWith('test@example.com', '123456')
    })
  })

  it('shows 2FA challenge when OTP requires totp', async () => {
    const user = userEvent.setup()
    vi.mocked(verifyLoginOtp).mockResolvedValue({
      status: 'totp_required',
      challenge_token: 'challenge-1',
    } as Awaited<ReturnType<typeof verifyLoginOtp>>)

    renderWithProviders(<LoginPage />)
    await user.type(screen.getByPlaceholderText('Work email'), 'test@example.com')
    await user.click(emailForm().getByRole('button', { name: /^Send sign-in code$/i }))
    await screen.findByPlaceholderText('Enter 6-digit code')
    await user.type(screen.getByPlaceholderText('Enter 6-digit code'), '123456')
    await user.click(screen.getByRole('button', { name: /^Verify & sign in$/i }))
    expect(await screen.findByPlaceholderText('Authenticator or recovery code')).toBeInTheDocument()
  })

  it('shows enrollment QR when setup is required', async () => {
    const user = userEvent.setup()
    vi.mocked(verifyLoginOtp).mockResolvedValue({
      status: 'needs_enrollment',
      challenge_token: 'challenge-2',
    } as Awaited<ReturnType<typeof verifyLoginOtp>>)
    vi.mocked(setup2faLogin).mockResolvedValue({
      secret: 'SECRET',
      otpauth_uri: 'otpauth://totp/FlowDesk',
    } as Awaited<ReturnType<typeof setup2faLogin>>)

    renderWithProviders(<LoginPage />)
    await user.type(screen.getByPlaceholderText('Work email'), 'test@example.com')
    await user.click(emailForm().getByRole('button', { name: /^Send sign-in code$/i }))
    await screen.findByPlaceholderText('Enter 6-digit code')
    await user.type(screen.getByPlaceholderText('Enter 6-digit code'), '123456')
    await user.click(screen.getByRole('button', { name: /^Verify & sign in$/i }))
    expect(await screen.findByTestId('qr-code')).toBeInTheDocument()
    expect(setup2faLogin).toHaveBeenCalled()
  })

  it('verifies TOTP on challenge step', async () => {
    const user = userEvent.setup()
    vi.mocked(verifyLoginOtp).mockResolvedValue({
      status: 'totp_required',
      challenge_token: 'challenge-1',
    } as Awaited<ReturnType<typeof verifyLoginOtp>>)
    vi.mocked(verify2fa).mockResolvedValue({
      access_token: 'token',
      user: mockUser,
      login_context: mockLoginContext,
    } as Awaited<ReturnType<typeof verify2fa>>)

    renderWithProviders(<LoginPage />)
    await user.type(screen.getByPlaceholderText('Work email'), 'test@example.com')
    await user.click(emailForm().getByRole('button', { name: /^Send sign-in code$/i }))
    await screen.findByPlaceholderText('Enter 6-digit code')
    await user.type(screen.getByPlaceholderText('Enter 6-digit code'), '123456')
    await user.click(screen.getByRole('button', { name: /^Verify & sign in$/i }))
    const totpInput = await screen.findByPlaceholderText('Authenticator or recovery code')
    await user.type(totpInput, '654321')
    await user.click(screen.getByRole('button', { name: /^Verify & sign in$/i }))
    await waitFor(() => {
      expect(verify2fa).toHaveBeenCalled()
    })
  })

  it('confirms 2FA enrollment', async () => {
    const user = userEvent.setup()
    vi.mocked(verifyLoginOtp).mockResolvedValue({
      status: 'needs_enrollment',
      challenge_token: 'challenge-2',
    } as Awaited<ReturnType<typeof verifyLoginOtp>>)
    vi.mocked(setup2faLogin).mockResolvedValue({
      secret: 'SECRET',
      otpauth_uri: 'otpauth://totp/FlowDesk',
    } as Awaited<ReturnType<typeof setup2faLogin>>)
    vi.mocked(confirm2faLogin).mockResolvedValue({
      recovery_codes: ['code-1', 'code-2'],
    } as Awaited<ReturnType<typeof confirm2faLogin>>)

    renderWithProviders(<LoginPage />)
    await user.type(screen.getByPlaceholderText('Work email'), 'test@example.com')
    await user.click(emailForm().getByRole('button', { name: /^Send sign-in code$/i }))
    await screen.findByPlaceholderText('Enter 6-digit code')
    await user.type(screen.getByPlaceholderText('Enter 6-digit code'), '123456')
    await user.click(screen.getByRole('button', { name: /^Verify & sign in$/i }))
    await screen.findByTestId('qr-code')
    await user.type(screen.getByPlaceholderText('Enter 6-digit code'), '123456')
    await user.click(screen.getByRole('button', { name: /^Verify & enable$/i }))
    await waitFor(() => {
      expect(confirm2faLogin).toHaveBeenCalled()
    })
  })
})
