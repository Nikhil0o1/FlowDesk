import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { api } from '@/lib/api'
import { mockCurrentContext, mockUser } from '@tests/fixtures'
import { emptyPage, mockChatMessage } from '@tests/mockData'
import { renderWithProviders } from '@tests/renderWithProviders'
import { setupPopulatedApiMock, setupPopulatedQueryMocks } from '@tests/smokeMocks'
import { useAuthStore } from '@/stores/auth'
import { useChannels } from '@/lib/queries'
import ChatPage from '@/pages/app/ChatPage'

describe('ChatPage', () => {
  beforeEach(() => {
    useAuthStore.setState({
      user: mockUser,
      loginContext: null,
      initialized: true,
      accessToken: 'test-token',
    })
    setupPopulatedQueryMocks()
    setupPopulatedApiMock()
    vi.mocked(api.post).mockResolvedValue(mockChatMessage({ id: 'msg-2', body: 'New message' }))
  })

  it('renders channel list and messages', async () => {
    renderWithProviders(<ChatPage />, {
      routerProps: { initialEntries: ['/app/chat?channel=ch-1'] },
    })
    expect(await screen.findByText('Hello team!')).toBeInTheDocument()
    expect(screen.getByText('general')).toBeInTheDocument()
  })

  it('sends a message', async () => {
    const user = userEvent.setup()
    renderWithProviders(<ChatPage />, {
      routerProps: { initialEntries: ['/app/chat?channel=ch-1'] },
    })
    await screen.findByText('Hello team!')
    const input = screen.getByPlaceholderText(/Write to #general/i)
    await user.type(input, 'New message{enter}')
    expect(api.post).toHaveBeenCalled()
  })

  it('shows empty state without channels', async () => {
    vi.mocked(useChannels).mockReturnValue({
      data: [],
      isLoading: false,
    } as ReturnType<typeof useChannels>)
    renderWithProviders(<ChatPage />)
    expect(await screen.findByText('No channels yet')).toBeInTheDocument()
  })

  it('opens channel settings from options menu', async () => {
    const user = userEvent.setup()
    renderWithProviders(<ChatPage />, {
      routerProps: { initialEntries: ['/app/chat?channel=ch-1'] },
    })
    await screen.findByText('Hello team!')
    await user.click(screen.getByTitle('Channel options'))
    await user.click(screen.getByRole('button', { name: /Settings/i }))
    expect(await screen.findByRole('heading', { name: 'Channel settings' })).toBeInTheDocument()
  })

  it('switches channels and opens members panel', async () => {
    const user = userEvent.setup()
    vi.mocked(useChannels).mockReturnValue({
      data: [
        { id: 'ch-1', name: 'general', is_private: false, unread_count: 0, workspace_id: 'ws-1' },
        { id: 'ch-2', name: 'random', is_private: false, unread_count: 2, workspace_id: 'ws-1' },
      ],
      isLoading: false,
    } as ReturnType<typeof useChannels>)
    vi.mocked(api.get).mockImplementation(async (url: string) => {
      if (url.includes('/channels/ch-2/messages')) {
        return { ...emptyPage, items: [mockChatMessage({ id: 'msg-3', body: 'Random chat' })], page_size: 100, total: 1 }
      }
      if (url.includes('/channels/ch-1/messages')) {
        return { ...emptyPage, items: [mockChatMessage()], page_size: 100, total: 1 }
      }
      if (url.includes('/members')) {
        return [{ id: 'cm-1', user_id: 'user-1', role: 'admin', user: { id: 'user-1', email: 'test@example.com', full_name: 'Test User', avatar_url: null } }]
      }
      return {}
    })

    renderWithProviders(<ChatPage />, {
      routerProps: { initialEntries: ['/app/chat?channel=ch-1'] },
    })
    await screen.findByText('Hello team!')
    await user.click(screen.getByText('random'))
    expect(await screen.findByText('Random chat')).toBeInTheDocument()
    await user.click(screen.getByTitle('Channel options'))
    await user.click(screen.getByRole('button', { name: /^Members$/i }))
    expect(await screen.findByRole('heading', { name: /#random — members/i })).toBeInTheDocument()
  })

  it('opens create channel modal', async () => {
    renderWithProviders(<ChatPage />, {
      routerProps: { initialEntries: ['/app/chat?new=1'] },
    })
    await screen.findByText('general')
    expect(await screen.findByRole('heading', { name: 'Create channel' })).toBeInTheDocument()
  })
})
