import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  browserNotificationsSupported,
  getBrowserNotificationPermission,
  requestBrowserNotificationPermission,
  showBrowserNotification,
} from '@/lib/browserNotifications'

describe('browserNotifications', () => {
  const NotificationMock = vi.fn()

  afterEach(() => {
    vi.unstubAllGlobals()
    NotificationMock.mockReset()
  })

  it('detects support and permission', () => {
    Object.assign(NotificationMock, { permission: 'default' })
    vi.stubGlobal('Notification', NotificationMock)
    expect(browserNotificationsSupported()).toBe(true)
    expect(getBrowserNotificationPermission()).toBe('default')
  })

  it('requests permission when not decided', async () => {
    Object.assign(NotificationMock, {
      permission: 'default',
      requestPermission: vi.fn().mockResolvedValue('granted'),
    })
    vi.stubGlobal('Notification', NotificationMock)
    await expect(requestBrowserNotificationPermission()).resolves.toBe('granted')
  })

  it('shows notification when granted', () => {
    Object.assign(NotificationMock, { permission: 'granted' })
    vi.stubGlobal('Notification', NotificationMock)
    showBrowserNotification('Hello', { body: 'World' })
    expect(NotificationMock).toHaveBeenCalledWith('Hello', expect.objectContaining({ body: 'World' }))
  })

  it('requests permission when already granted or denied', async () => {
    Object.assign(NotificationMock, { permission: 'granted' })
    vi.stubGlobal('Notification', NotificationMock)
    await expect(requestBrowserNotificationPermission()).resolves.toBe('granted')

    Object.assign(NotificationMock, { permission: 'denied' })
    await expect(requestBrowserNotificationPermission()).resolves.toBe('denied')
  })

  it('no-ops when permission denied', () => {
    Object.assign(NotificationMock, { permission: 'denied' })
    vi.stubGlobal('Notification', NotificationMock)
    showBrowserNotification('x')
    expect(NotificationMock).not.toHaveBeenCalled()
  })
})
