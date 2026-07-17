import { screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { renderWithProviders } from '@tests/renderWithProviders'
import ResetPasswordPage from '@/pages/auth/ResetPasswordPage'

const consumeAuthTokenFromUrl = vi.fn()

vi.mock('@/lib/fragmentToken', () => ({
  consumeAuthTokenFromUrl: (...args: unknown[]) => consumeAuthTokenFromUrl(...args),
}))

describe('ResetPasswordPage', () => {
  beforeEach(() => {
    consumeAuthTokenFromUrl.mockReset()
  })

  it('shows invalid link when token is missing', () => {
    consumeAuthTokenFromUrl.mockReturnValue(null)

    renderWithProviders(<ResetPasswordPage />)

    expect(screen.getByRole('heading', { name: 'Invalid reset link' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Go to login' })).toBeInTheDocument()
  })

  it('shows passwordless guidance when token is present', () => {
    consumeAuthTokenFromUrl.mockReturnValue('reset-token-123')

    renderWithProviders(<ResetPasswordPage />)

    expect(screen.getByRole('heading', { name: 'Passwordless sign-in' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Go to login' })).toBeInTheDocument()
  })
})
