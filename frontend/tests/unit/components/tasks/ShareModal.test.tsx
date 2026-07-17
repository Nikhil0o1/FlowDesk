import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi, beforeEach } from 'vitest'

import { ShareModal } from '@/components/tasks/ShareModal'
import { api } from '@/lib/api'
import { INVITE_EMAIL_ERROR } from '@/lib/emailValidation'
import { renderWithProviders } from '@tests/renderWithProviders'

const shareState = {
  is_private: false,
  public_enabled: false,
  public_url: null,
  public_token: null,
  public_expires_at: null,
  public_searchable: false,
  members: [],
}

describe('ShareModal', () => {
  beforeEach(() => {
    vi.mocked(api.get).mockImplementation(async (url: string) => {
      if (url.includes('/share')) return shareState
      return {}
    })
  })

  it('blocks invite for invalid email and shows validation error', async () => {
    const user = userEvent.setup()

    renderWithProviders(<ShareModal open taskId="task-1" taskTitle="API Testing" onClose={vi.fn()} />)
    await screen.findByRole('heading', { name: 'Share this task' })

    const input = await screen.findByPlaceholderText(/invite by email/i)
    await user.type(input, 'not-an-email')
    await user.click(screen.getByRole('button', { name: 'Invite' }))

    expect(screen.getByText(INVITE_EMAIL_ERROR)).toBeInTheDocument()
    expect(api.post).not.toHaveBeenCalled()
  })

  it('sends invite when email is valid', async () => {
    const user = userEvent.setup()
    vi.mocked(api.post).mockResolvedValue(shareState)

    renderWithProviders(<ShareModal open taskId="task-1" taskTitle="API Testing" onClose={vi.fn()} />)
    await screen.findByRole('heading', { name: 'Share this task' })

    const input = await screen.findByPlaceholderText(/invite by email/i)
    await user.type(input, 'jane@example.com')
    await user.click(screen.getByRole('button', { name: 'Invite' }))

    await waitFor(() => {
      expect(api.post).toHaveBeenCalledWith('/tasks/task-1/share/members', {
        email: 'jane@example.com',
        role: 'viewer',
      })
    })
  })
})
