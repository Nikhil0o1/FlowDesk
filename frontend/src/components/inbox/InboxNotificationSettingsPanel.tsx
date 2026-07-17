import { ArrowLeft, Bell, Inbox, Mail, Monitor, X } from 'lucide-react'
import { useQueryClient } from '@tanstack/react-query'
import { useEffect, useState } from 'react'

import { api } from '../../lib/api'
import {
  browserNotificationsSupported,
  getBrowserNotificationPermission,
  requestBrowserNotificationPermission,
} from '../../lib/browserNotifications'
import { invalidateInbox, useNotificationPreferences, usePatchInboxSettings } from '../../lib/inboxQueries'
import type { InboxSettings } from '../../lib/types'
import { cn } from '../../lib/utils'
import { useUIStore } from '../../stores/ui'
import { InboxToggle } from './InboxToggle'

export function InboxNotificationSettingsPanel({
  settings,
  onBack,
  onClose,
  onOpenImportance,
}: {
  settings: InboxSettings
  onBack: () => void
  onClose: () => void
  onOpenImportance: () => void
}) {
  const queryClient = useQueryClient()
  const patch = usePatchInboxSettings()
  const prefs = useNotificationPreferences()
  const notificationsMuted = useUIStore((s) => s.notificationsMuted)
  const toggleNotificationsMuted = useUIStore((s) => s.toggleNotificationsMuted)
  const [browserPermission, setBrowserPermission] = useState(getBrowserNotificationPermission())
  const [testEmailSent, setTestEmailSent] = useState(false)

  useEffect(() => {
    setBrowserPermission(getBrowserNotificationPermission())
  }, [settings.browser_notifications_enabled])

  const update = (body: Partial<InboxSettings>) => patch.mutate(body)

  const markAllRead = async () => {
    await api.post('/notifications/read-all')
    invalidateInbox(queryClient)
  }

  const sendTestEmail = async () => {
    await api.post('/notifications/test-email')
    setTestEmailSent(true)
    setTimeout(() => setTestEmailSent(false), 3000)
  }

  const enableBrowser = async () => {
    const permission = await requestBrowserNotificationPermission()
    setBrowserPermission(permission)
    if (permission === 'granted') {
      update({ browser_notifications_enabled: true })
    }
  }

  const browserEnabled = settings.browser_notifications_enabled && browserPermission === 'granted'
  const importantCount = prefs.data?.important_count ?? 0
  const totalCount = prefs.data?.total_count ?? 0

  return (
    <div className="flex h-full min-h-0 flex-col bg-[#fafafa]">
      <header className="shrink-0 border-b border-[#e8eaed] bg-white">
        <div className="mx-auto flex max-w-3xl items-center gap-2 px-6 py-4">
          <button onClick={onBack} className="rounded p-1.5 text-[#6b7280] hover:bg-[#f3f4f6]">
            <ArrowLeft size={18} />
          </button>
          <h1 className="flex-1 text-[20px] font-semibold text-[#1a1d21]">Notification settings</h1>
          <button onClick={onClose} className="rounded p-1.5 text-[#6b7280] hover:bg-[#f3f4f6]">
            <X size={18} />
          </button>
        </div>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto max-w-3xl px-6 py-6">
          <button
            type="button"
            onClick={onOpenImportance}
            className="mb-5 text-[13px] text-[#6b7280] underline-offset-2 hover:text-[#374151] hover:underline"
          >
            Learn more about customizing your notifications
          </button>

          <SettingsCard
            icon={<Inbox size={20} />}
            title="Inbox"
            description="Default — FlowDesk recommended importance settings"
            action={
              <button
                onClick={onOpenImportance}
                className="rounded-md border border-[#e5e7eb] bg-white px-3 py-1.5 text-[13px] font-medium text-[#374151] hover:bg-[#f9fafb]"
              >
                {importantCount}/{totalCount} ›
              </button>
            }
          />

          <SettingsCard
            icon={<Mail size={20} />}
            title="Email"
            description={
              settings.email_notifications_enabled
                ? 'Default — mentions, assignments, and reminders'
                : 'Disabled — no notification emails will be sent'
            }
            action={
              <div className="flex items-center gap-3">
                <button
                  onClick={() => void sendTestEmail()}
                  disabled={!settings.email_notifications_enabled || patch.isPending}
                  className="text-[13px] text-[#6b7280] hover:text-[#374151] disabled:opacity-40"
                >
                  {testEmailSent ? 'Sent!' : 'Send test notification'}
                </button>
                <InboxToggle
                  checked={settings.email_notifications_enabled}
                  onChange={(v) => update({ email_notifications_enabled: v })}
                  accent="amber"
                />
              </div>
            }
          />

          <SettingsCard
            icon={<Monitor size={20} />}
            title="Browser"
            description={
              browserEnabled
                ? 'Desktop notifications enabled'
                : browserPermission === 'denied'
                  ? 'Blocked — enable in browser site settings'
                  : 'Notifications are disabled'
            }
            action={
              browserEnabled ? (
                <InboxToggle
                  checked
                  onChange={(v) => {
                    if (!v) update({ browser_notifications_enabled: false })
                  }}
                  accent="amber"
                />
              ) : (
                <button
                  onClick={() => void enableBrowser()}
                  disabled={!browserNotificationsSupported() || browserPermission === 'denied'}
                  className="rounded-md border border-[#e5e7eb] bg-white px-3 py-1.5 text-[13px] font-medium text-[#374151] hover:bg-[#f9fafb] disabled:opacity-40"
                >
                  Enable notifications
                </button>
              )
            }
          />

          <SettingsCard
            icon={<Bell size={20} />}
            title="Mute in app"
            description="Hide badges while keeping your inbox up to date"
            action={
              <InboxToggle
                checked={notificationsMuted}
                onChange={(v) => {
                  if (v !== notificationsMuted) toggleNotificationsMuted()
                }}
                accent="amber"
              />
            }
          />

          <div className="mt-6 border-t border-[#eef0f2] pt-6">
            <p className="text-[12px] font-semibold uppercase tracking-wide text-[#9ca3af]">General settings</p>
            <div className="mt-3 flex items-center justify-between rounded-xl border border-[#e5e7eb] bg-white px-4 py-3.5">
              <div>
                <p className="text-[14px] font-medium text-[#374151]">Auto-follow tasks I am involved in</p>
                <p className="mt-1 text-[12px] text-[#9ca3af]">
                  When I create, edit, or comment on a task
                </p>
              </div>
              <InboxToggle
                checked={settings.auto_follow_tasks}
                onChange={(v) => update({ auto_follow_tasks: v })}
                accent="amber"
              />
            </div>
            <button
              onClick={() => void markAllRead()}
              className="mt-3 w-full rounded-xl border border-[#e5e7eb] bg-white px-4 py-3 text-left text-[14px] text-[#374151] hover:bg-[#f9fafb]"
            >
              Mark all notifications as read
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

function SettingsCard({
  icon,
  title,
  description,
  action,
}: {
  icon: React.ReactNode
  title: string
  description: string
  action: React.ReactNode
}) {
  return (
    <div className="mb-3 flex items-center gap-4 rounded-xl border border-[#e5e7eb] bg-white px-4 py-4">
      <span className="shrink-0 text-[#6b7280]">{icon}</span>
      <div className="min-w-0 flex-1">
        <p className="text-[14px] font-medium text-[#1a1d21]">{title}</p>
        <p className="mt-0.5 text-[12px] text-[#9ca3af]">{description}</p>
      </div>
      <div className="shrink-0">{action}</div>
    </div>
  )
}
