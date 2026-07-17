import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { mockUser } from '@tests/fixtures'
import { renderWithProviders } from '@tests/renderWithProviders'
import { useAuthStore } from '@/stores/auth'
import { ProfileDrawer } from '@/components/profile/ProfileDrawer'

const navigate = vi.fn()

vi.mock('react-router-dom', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-router-dom')>()
  return {
    ...actual,
    useNavigate: () => navigate,
  }
})

describe('ProfileDrawer', () => {
  beforeEach(() => {
    navigate.mockClear()
    useAuthStore.setState({
      user: mockUser,
      loginContext: null,
      initialized: true,
      accessToken: 'test-token',
    })
  })

  it('navigates to the standups tab from the quick action', async () => {
    const onClose = vi.fn()
    const user = userEvent.setup()
    renderWithProviders(<ProfileDrawer open onClose={onClose} />)

    await user.click(screen.getByRole('button', { name: /Standups/i }))

    expect(onClose).toHaveBeenCalled()
    expect(navigate).toHaveBeenCalledWith('/app/sprints?tab=standups')
  })
})
