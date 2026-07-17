export type BrowserPermission = NotificationPermission | 'unsupported'

export function browserNotificationsSupported(): boolean {
  return typeof window !== 'undefined' && 'Notification' in window
}

export function getBrowserNotificationPermission(): BrowserPermission {
  if (!browserNotificationsSupported()) return 'unsupported'
  return Notification.permission
}

export async function requestBrowserNotificationPermission(): Promise<BrowserPermission> {
  if (!browserNotificationsSupported()) return 'unsupported'
  if (Notification.permission === 'granted') return 'granted'
  if (Notification.permission === 'denied') return 'denied'
  return Notification.requestPermission()
}

export function showBrowserNotification(title: string, options?: NotificationOptions) {
  if (!browserNotificationsSupported() || Notification.permission !== 'granted') return
  try {
    new Notification(title, {
      icon: '/favicon.ico',
      ...options,
    })
  } catch {
    // Some browsers block without service worker — ignore.
  }
}
