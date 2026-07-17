import { screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { renderWithProviders } from '@tests/renderWithProviders'
import { AuthLogo, AuthShell } from '@/pages/auth/AuthShell'

describe('AuthShell', () => {
  it('renders children and support footer', () => {
    renderWithProviders(
      <AuthShell>
        <AuthLogo />
        <h1>Test heading</h1>
      </AuthShell>,
    )

    expect(screen.getByRole('heading', { name: 'Test heading' })).toBeInTheDocument()
    expect(screen.getByText('Contact support')).toBeInTheDocument()
    expect(screen.getAllByAltText('FlowDesk').length).toBeGreaterThan(0)
  })

  it('renders marketing copy in the shell layout', () => {
    renderWithProviders(
      <AuthShell>
        <p>Child content</p>
      </AuthShell>,
    )

    expect(screen.getByText('Child content')).toBeInTheDocument()
    expect(screen.getByText(/Work flows better/i)).toBeInTheDocument()
  })
})
