import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { api } from '@/lib/api'
import { emptyPage, mockNotification } from '@tests/mockData'
import { renderWithProviders } from '@tests/renderWithProviders'
import { NotificationsDropdown, notificationTarget, navigateToNotification } from '@/components/notifications/NotificationsDropdown'
import { useWorkspaceStore } from '@/stores/workspace'

describe('notificationTarget', () => {
  it('routes task notifications to task page', () => {
    expect(
      notificationTarget(mockNotification({ data: { task_id: 'task-1' } })),
    ).toBe('/app/tasks/task-1')
  })

  it('routes chat mentions to chat', () => {
    expect(notificationTarget(mockNotification({ type: 'chat_mention', data: {} }))).toBe('/app/chat')
  })

  it('routes sprint notifications', () => {
    expect(
      notificationTarget(mockNotification({ data: { sprint_id: 'sprint-1' } })),
    ).toBe('/app/sprints?sprint=sprint-1')
  })

  it('routes goal share notifications via url', () => {
    expect(
      notificationTarget(
        mockNotification({ type: 'goal_shared', data: { url: '/app/goals?goal=goal-1' } }),
      ),
    ).toBe('/app/goals?goal=goal-1')
  })
})

describe('navigateToNotification', () => {
  it('switches workspace before navigating', () => {
    const navigate = vi.fn()
    navigateToNotification(
      mockNotification({
        workspace_id: 'ws-99',
        data: { url: '/app/goals?goal=goal-1' },
      }),
      navigate,
    )
    expect(useWorkspaceStore.getState().currentWorkspaceId).toBe('ws-99')
    expect(navigate).toHaveBeenCalledWith('/app/goals?goal=goal-1')
  })

  it('supports a path override', () => {
    const navigate = vi.fn()
    navigateToNotification(
      mockNotification({ data: { task_id: 'task-1' } }),
      navigate,
      '/app/tasks/task-1?comment=c1',
    )
    expect(navigate).toHaveBeenCalledWith('/app/tasks/task-1?comment=c1')
  })
})

describe('NotificationsDropdown', () => {
  beforeEach(() => {
    vi.mocked(api.get).mockResolvedValue({
      ...emptyPage,
      items: [mockNotification({ title: 'Task assigned', body: 'You were assigned Fix bug' })],
      total: 1,
      page_size: 8,
    })
    vi.mocked(api.post).mockResolvedValue({})
  })

  it('marks all read', async () => {
    const user = userEvent.setup()
    const onClose = vi.fn()
    renderWithProviders(<NotificationsDropdown onClose={onClose} />, {
      routerProps: { initialEntries: ['/app/dashboard'] },
    })
    expect(await screen.findByText('Task assigned')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /mark all read/i }))
    expect(api.post).toHaveBeenCalledWith('/notifications/read-all')
  })

  it('opens a notification', async () => {
    const user = userEvent.setup()
    const onClose = vi.fn()
    renderWithProviders(<NotificationsDropdown onClose={onClose} />, {
      routerProps: { initialEntries: ['/app/dashboard'] },
    })
    await user.click(await screen.findByText('Task assigned'))
    expect(onClose).toHaveBeenCalled()
    expect(api.post).toHaveBeenCalledWith('/notifications/notif-1/read')
  })

  it('shows empty state', async () => {
    vi.mocked(api.get).mockResolvedValue({ ...emptyPage, items: [], total: 0, page_size: 8 })
    renderWithProviders(<NotificationsDropdown onClose={vi.fn()} />)
    expect(await screen.findByText(/all caught up/i)).toBeInTheDocument()
  })
})
