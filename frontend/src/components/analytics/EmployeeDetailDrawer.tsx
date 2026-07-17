import { motion } from 'framer-motion'
import { Clock, Globe, Laptop, MapPin, X } from 'lucide-react'
import { useEffect } from 'react'
import { createPortal } from 'react-dom'

import { useAnalyticsUserDetail } from '../../lib/queries'
import type { PresenceStatus, StatusTimelineItem, WeeklyActivityDay } from '../../lib/types'
import { cn, formatDateTimeInTimezone, timeAgo } from '../../lib/utils'
import { useAuthStore } from '../../stores/auth'
import { Avatar } from '../ui/Avatar'
import { CenteredSpinner } from '../ui/Spinner'
import { STATUS_META, StatusPill, durationLabel } from './AnalyticsWidgets'

const WEEKDAY = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

export function EmployeeDetailDrawer({
  orgId,
  userId,
  onClose,
}: {
  orgId: string | undefined
  userId: string
  onClose: () => void
}) {
  const { data, isLoading } = useAnalyticsUserDetail(orgId, userId)
  const viewerTimezone = useAuthStore((s) => s.user?.profile?.timezone || 'UTC')

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const row = data?.row

  return createPortal(
    <>
      <div className="fixed inset-0 z-[60] bg-black/40" onClick={onClose} />
      <aside className="fixed bottom-0 right-0 top-0 z-[70] w-[460px] max-w-full overflow-y-auto border-l border-ink-700 bg-ink-900 shadow-popover">
        <button
          onClick={onClose}
          className="absolute right-4 top-4 rounded-lg p-1.5 text-fg-muted transition-colors hover:bg-ink-750 hover:text-fg"
        >
          <X size={17} />
        </button>

        {isLoading || !row ? (
          <div className="py-20">
            <CenteredSpinner />
          </div>
        ) : (
          <div className="space-y-6 p-6">
            {/* Profile */}
            <div className="flex items-start gap-4">
              <Avatar
                name={row.user.full_name || row.user.email}
                src={row.user.avatar_url}
                color={row.user.avatar_color}
                size={64}
                userId={row.user.id}
                showPresence
              />
              <div className="min-w-0 flex-1 pt-1">
                <h2 className="truncate text-lg font-bold text-fg">
                  {row.user.full_name || row.user.email}
                </h2>
                <p className="truncate text-sm text-fg-muted">{row.user.email}</p>
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  <StatusPill status={row.status} />
                  {row.role && (
                    <span className="rounded-full bg-ink-800 px-2 py-0.5 text-[11px] capitalize text-fg-secondary">
                      {row.role}
                    </span>
                  )}
                </div>
              </div>
            </div>

            {(data?.title || data?.timezone) && (
              <div className="grid grid-cols-2 gap-2 text-sm">
                {data?.title && <Meta label="Title" value={data.title} />}
                {data?.timezone && <Meta label="Timezone" value={data.timezone} />}
              </div>
            )}

            {/* Current session */}
            <Section title="Current Session">
              {data?.current_session ? (
                <div className="grid grid-cols-2 gap-2 text-sm">
                  <Meta icon={<Clock size={12} />} label="Since" value={formatDateTimeInTimezone(data.current_session.login_time, viewerTimezone)} />
                  <Meta label="Duration" value={durationLabel(data.current_session.duration)} />
                  <Meta icon={<Laptop size={12} />} label="Device" value={data.current_session.device ?? '—'} />
                  <Meta icon={<Globe size={12} />} label="Browser" value={data.current_session.browser ?? '—'} />
                  {data.current_session.ip_address && (
                    <Meta icon={<MapPin size={12} />} label="IP" value={data.current_session.ip_address} />
                  )}
                </div>
              ) : (
                <p className="text-sm text-fg-muted">Not currently online.</p>
              )}
            </Section>

            {/* Weekly activity */}
            <Section title="Weekly Activity">
              <WeeklyActivityChart days={data?.weekly_activity ?? []} />
            </Section>

            {/* Status timeline */}
            <Section title="Status Timeline">
              <StatusTimeline items={data?.status_timeline ?? []} />
            </Section>

            {/* Recent sessions */}
            {data && data.recent_sessions.length > 0 && (
              <Section title="Recent Sessions">
                <div className="space-y-1.5">
                  {data.recent_sessions.map((s) => (
                    <div
                      key={s.id}
                      className="flex items-center justify-between rounded-lg bg-ink-850/60 px-3 py-2 text-xs"
                    >
                      <span className="text-fg-secondary">{formatDateTimeInTimezone(s.login_time, viewerTimezone)}</span>
                      <span className="text-fg-muted">
                        {s.device ?? '—'} · {durationLabel(s.duration)}
                      </span>
                    </div>
                  ))}
                </div>
              </Section>
            )}
          </div>
        )}
      </aside>
    </>,
    document.body,
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <h3 className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-fg-muted">{title}</h3>
      {children}
    </div>
  )
}

function Meta({ icon, label, value }: { icon?: React.ReactNode; label: string; value: string }) {
  return (
    <div className="rounded-lg bg-ink-850/60 px-3 py-2">
      <p className="flex items-center gap-1 text-[10px] uppercase tracking-wider text-fg-muted">
        {icon}
        {label}
      </p>
      <p className="mt-0.5 truncate text-sm text-fg">{value}</p>
    </div>
  )
}

function WeeklyActivityChart({ days }: { days: WeeklyActivityDay[] }) {
  if (days.length === 0) return <p className="text-sm text-fg-muted">No activity recorded.</p>
  const maxSeconds = Math.max(...days.map((d) => d.total_seconds), 1)
  return (
    <div className="flex items-end justify-between gap-2">
      {days.map((d) => {
        const heightPct = Math.round((d.total_seconds / maxSeconds) * 100)
        const dayIdx = new Date(`${d.date}T00:00:00`).getDay()
        return (
          <div key={d.date} className="flex flex-1 flex-col items-center gap-1">
            <div className="flex h-24 w-full items-end">
              <motion.div
                className="w-full rounded-t bg-brand/70"
                initial={{ height: 0 }}
                animate={{ height: `${Math.max(heightPct, d.total_seconds > 0 ? 6 : 0)}%` }}
                transition={{ duration: 0.6 }}
                title={`${durationLabel(d.total_seconds)} · ${d.session_count} session${d.session_count === 1 ? '' : 's'}`}
              />
            </div>
            <span className="text-[9px] text-fg-muted">{WEEKDAY[dayIdx]}</span>
          </div>
        )
      })}
    </div>
  )
}

function timelineColor(item: StatusTimelineItem): string {
  const status = (item.new_status as PresenceStatus) || 'offline'
  return STATUS_META[status]?.color ?? '#87909E'
}

function StatusTimeline({ items }: { items: StatusTimelineItem[] }) {
  if (items.length === 0) return <p className="text-sm text-fg-muted">No status changes yet.</p>
  return (
    <div className="space-y-0">
      {items.map((item, i) => (
        <div key={i} className="flex gap-3">
          <div className="flex flex-col items-center">
            <span
              className="mt-1 h-2.5 w-2.5 shrink-0 rounded-full"
              style={{ backgroundColor: timelineColor(item) }}
            />
            {i < items.length - 1 && <span className="w-px flex-1 bg-ink-700" />}
          </div>
          <div className={cn('pb-3', i === items.length - 1 && 'pb-0')}>
            <p className="text-xs text-fg">
              {item.event_type === 'status_change' && item.old_status && item.new_status
                ? `${item.old_status} → ${item.new_status}`
                : item.event_type.replace(/_/g, ' ')}
            </p>
            <p className="text-[10px] text-fg-muted">{timeAgo(item.created_at)}</p>
          </div>
        </div>
      ))}
    </div>
  )
}
