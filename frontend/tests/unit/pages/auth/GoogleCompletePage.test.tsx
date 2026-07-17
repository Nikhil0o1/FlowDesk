import { waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { completeOAuthLogin } from '@/lib/api'
import { mockLoginContext, mockUser } from '@tests/fixtures'
import { renderWithProviders } from '@tests/renderWithProviders'
import { useAuthStore } from '@/stores/auth'
import GoogleCompletePage from '@/pages/auth/GoogleCompletePage'

vi.mock('@/lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api')>()
  return {
    ...actual,
    completeOAuthLogin: vi.fn(),
  }
})

const navigate = vi.fn()

vi.mock('react-router-dom', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-router-dom')>()
  return {
    ...actual,
    useNavigate: () => navigate,
  }
})

describe('GoogleCompletePage', () => {
  beforeEach(() => {
    navigate.mockReset()
    vi.mocked(completeOAuthLogin).mockReset()
    useAuthStore.setState({
      accessToken: 'token',
      user: mockUser,
      loginContext: mockLoginContext,
      initialized: true,
    })
  })

  it('shows a spinner while completing OAuth', () => {
    vi.mocked(completeOAuthLogin).mockReturnValue(new Promise(() => {}))
    renderWithProviders(<GoogleCompletePage />, {
      routerProps: { initialEntries: ['/auth/google/complete'] },
    })
    expect(document.querySelector('.animate-spin')).toBeTruthy()
  })

  it('navigates to the workspace when session establishment succeeds', async () => {
    vi.mocked(completeOAuthLogin).mockResolvedValue(true)

    renderWithProviders(<GoogleCompletePage />, {
      routerProps: { initialEntries: ['/auth/google/complete'] },
    })

    await waitFor(() => {
      expect(completeOAuthLogin).toHaveBeenCalled()
      expect(navigate).toHaveBeenCalledWith(mockLoginContext.redirect_to, { replace: true })
    })
  })

  it('redirects to login when session establishment fails', async () => {
    vi.mocked(completeOAuthLogin).mockResolvedValue(false)

    renderWithProviders(<GoogleCompletePage />, {
      routerProps: { initialEntries: ['/auth/google/complete'] },
    })

    await waitFor(() => {
      expect(navigate).toHaveBeenCalledWith('/login?error=google_failed', { replace: true })
    })
  })
})
