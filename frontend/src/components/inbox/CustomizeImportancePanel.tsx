import { ArrowLeft, Search, X } from 'lucide-react'
import { useMemo, useState } from 'react'

import {
  useNotificationPreferences,
  usePatchNotificationPreference,
  useResetNotificationPreferences,
} from '../../lib/inboxQueries'
import { cn } from '../../lib/utils'
import { CenteredSpinner } from '../ui/Spinner'
import { InboxToggle } from './InboxToggle'
import { notificationTypeIcon } from './notificationTypeIcons'

export function CustomizeImportancePanel({
  onBack,
  onClose,
  fullScreen = false,
}: {
  onBack: () => void
  onClose: () => void
  fullScreen?: boolean
}) {
  const { data, isLoading } = useNotificationPreferences()
  const patch = usePatchNotificationPreference()
  const reset = useResetNotificationPreferences()
  const [search, setSearch] = useState('')

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!data) return []
    if (!q) return data.items
    return data.items.filter((item) => item.label.toLowerCase().includes(q) || item.type.includes(q))
  }, [data, search])

  const important = filtered.filter((i) => i.section === 'important')
  const notImportant = filtered.filter((i) => i.section === 'not_important')
  const hasResults = important.length > 0 || notImportant.length > 0

  const shellClass = fullScreen
    ? 'flex h-full min-h-0 flex-col bg-[#fafafa]'
    : 'flex h-full w-[320px] shrink-0 flex-col border-l border-[#e8eaed] bg-white'

  const headerInnerClass = fullScreen ? 'mx-auto flex max-w-3xl items-center gap-2 px-6 py-4' : 'flex items-center gap-2 px-3 py-3'
  const bodyClass = fullScreen ? 'mx-auto w-full max-w-3xl px-6' : 'px-3'
  const listClass = fullScreen ? 'min-h-0 flex-1 overflow-y-auto px-6 pb-24' : 'min-h-0 flex-1 overflow-y-auto px-2 pb-20'
  const footerClass = fullScreen
    ? 'shrink-0 border-t border-[#e8eaed] bg-white'
  : 'border-t border-[#e8eaed]'

  return (
    <div className={shellClass}>
      <header className={cn('shrink-0 border-b border-[#e8eaed]', fullScreen ? 'bg-white' : '')}>
        <div className={headerInnerClass}>
          <button onClick={onBack} className="rounded p-1.5 text-[#6b7280] hover:bg-[#f3f4f6]">
            <ArrowLeft size={fullScreen ? 18 : 16} />
          </button>
          <h3
            className={cn(
              'flex-1 font-semibold text-[#1a1d21]',
              fullScreen ? 'text-[20px]' : 'text-[15px]',
            )}
          >
            Customize importance
          </h3>
          <button onClick={onClose} className="rounded p-1.5 text-[#6b7280] hover:bg-[#f3f4f6]">
            <X size={fullScreen ? 18 : 16} />
          </button>
        </div>
      </header>

      <div className={cn('py-2', bodyClass)}>
        <div className="relative">
          <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[#9ca3af]" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search..."
            className="w-full rounded-md border border-[#e5e7eb] bg-white py-1.5 pl-8 pr-3 text-[13px] outline-none focus:border-[#c4a574]"
          />
        </div>
      </div>

      <div className={listClass}>
        {isLoading ? (
          <CenteredSpinner />
        ) : !hasResults ? (
          <p className="px-2 py-6 text-center text-[13px] text-[#9ca3af]">No notification types match your search.</p>
        ) : (
          <>
            {important.length > 0 && (
              <Section title="Important">
                {important.map((item) => (
                  <PreferenceRow
                    key={item.type}
                    type={item.type}
                    label={item.label}
                    checked={item.important}
                    disabled={patch.isPending}
                    onChange={(v) => patch.mutate({ type: item.type, important: v })}
                  />
                ))}
                <p className="px-2 pb-2 text-[11px] leading-relaxed text-[#9ca3af]">
                  Toggles apply immediately — notifications move between Primary and Other.
                </p>
              </Section>
            )}
            {notImportant.length > 0 && (
              <Section title="Not Important">
                {notImportant.map((item) => (
                  <PreferenceRow
                    key={item.type}
                    type={item.type}
                    label={item.label}
                    checked={item.important}
                    disabled={patch.isPending}
                    onChange={(v) => patch.mutate({ type: item.type, important: v })}
                  />
                ))}
              </Section>
            )}
          </>
        )}
      </div>

      <div className={footerClass}>
        <div className={cn(fullScreen && 'mx-auto max-w-3xl px-6 py-4')}>
          <button
            onClick={() => reset.mutate()}
            disabled={reset.isPending || isLoading}
            className={cn(
              'w-full rounded-md py-2 text-[13px] font-medium text-[#a67c52] hover:bg-[#faf6f0] disabled:opacity-50',
              fullScreen && 'rounded-xl border border-[#e5e7eb] bg-white py-3',
            )}
          >
            Reset to default
          </button>
        </div>
      </div>
    </div>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="mb-2">
      <p className="px-2 py-2 text-[11px] font-semibold uppercase tracking-wide text-[#9ca3af]">{title}</p>
      {children}
    </div>
  )
}

function PreferenceRow({
  type,
  label,
  checked,
  disabled,
  onChange,
}: {
  type: string
  label: string
  checked: boolean
  disabled?: boolean
  onChange: (v: boolean) => void
}) {
  const Icon = notificationTypeIcon(type)
  return (
    <div className="flex items-center gap-2 rounded-md px-2 py-2 hover:bg-[#f9fafb]">
      <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-[#f3f4f6] text-[#6b7280]">
        <Icon size={14} strokeWidth={1.75} />
      </span>
      <span className="min-w-0 flex-1 text-[13px] text-[#374151]">{label}</span>
      <InboxToggle checked={checked} onChange={onChange} disabled={disabled} accent="amber" />
    </div>
  )
}
