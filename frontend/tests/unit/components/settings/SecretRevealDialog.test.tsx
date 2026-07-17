import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import { SecretRevealDialog } from '@/components/settings/apiKeys/SecretRevealDialog'
import { renderWithProviders } from '@tests/renderWithProviders'

const RAW = 'fd_live_pk_xyz_onlyonce'

describe('SecretRevealDialog', () => {
  it('requires acknowledgement before Done and does not persist secret', async () => {
    const user = userEvent.setup()
    const onClose = vi.fn()
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText },
    })

    renderWithProviders(
      <SecretRevealDialog
        secret={{ raw: RAW, keyName: 'CI', reason: 'created', tokenId: 'tok-1' }}
        onAcknowledgedClose={onClose}
      />,
    )

    expect(screen.getByText(RAW)).toBeInTheDocument()
    expect(screen.getByText(/cannot show it again/i)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Done' })).toBeDisabled()

    await user.click(screen.getByRole('button', { name: 'Copy API key' }))
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(RAW))

    await user.click(screen.getByRole('checkbox', { name: /I have saved this key/i }))
    expect(screen.getByRole('button', { name: 'Done' })).toBeEnabled()
    await user.click(screen.getByRole('button', { name: 'Done' }))
    expect(onClose).toHaveBeenCalled()

    expect(localStorage.length).toBe(0)
    expect(sessionStorage.length).toBe(0)
  })

  it('warns when closing without acknowledgement', async () => {
    const user = userEvent.setup()
    const onClose = vi.fn()

    renderWithProviders(
      <SecretRevealDialog
        secret={{ raw: RAW, keyName: 'CI', reason: 'rotated', tokenId: 'tok-2' }}
        onAcknowledgedClose={onClose}
      />,
    )

    await user.click(screen.getByRole('button', { name: 'Close' }))
    expect(onClose).not.toHaveBeenCalled()
    expect(screen.getByRole('alert')).toHaveTextContent(/Confirm you have saved/i)
    expect(screen.getByText(RAW)).toBeInTheDocument()
  })
})
