import { Check, Eye, Keyboard, Layers, ListOrdered, Settings, SlidersHorizontal, X } from 'lucide-react'

import {
  usePatchInboxSettings,
  useNotificationPreferences,
} from '../../lib/inboxQueries'
import type { InboxSettings } from '../../lib/types'
import { cn } from '../../lib/utils'
import { InboxToggle } from './InboxToggle'

export function CustomizeInboxPanel({
  settings,
  onClose,
  onOpenImportance,
  onOpenNotificationSettings,
  onOpenKeyboardShortcuts,
}: {
  settings: InboxSettings
  onClose: () => void
  onOpenImportance: () => void
  onOpenNotificationSettings: () => void
  onOpenKeyboardShortcuts: () => void
}) {
  const patch = usePatchInboxSettings()
  const prefs = useNotificationPreferences()

  const update = (body: Partial<InboxSettings>) => patch.mutate(body)

  return (
    <aside className="flex h-full w-[300px] shrink-0 flex-col border-l border-[#e8eaed] bg-white">
      <div className="flex items-center justify-between border-b border-[#e8eaed] px-4 py-3">
        <h3 className="text-[15px] font-semibold text-[#1a1d21]">Customize Inbox</h3>
        <button onClick={onClose} className="rounded p-1 text-[#6b7280] hover:bg-[#f3f4f6]">
          <X size={16} />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto px-4 py-3">
        <ToggleRow
          icon={<Eye size={15} />}
          label="Show All tab"
          checked={settings.show_all_tab}
          onChange={(v) => update({ show_all_tab: v })}
        />
        <ToggleRow
          icon={<Layers size={15} />}
          label="Group by date"
          checked={settings.group_by_date}
          onChange={(v) => update({ group_by_date: v })}
        />
        <ToggleRow
          icon={<ListOrdered size={15} />}
          label="Sort by newest first"
          checked={settings.sort_newest_first}
          onChange={(v) => update({ sort_newest_first: v })}
        />

        <div className="mt-5 border-t border-[#eef0f2] pt-4">
          <p className="text-[12px] font-semibold uppercase tracking-wide text-[#9ca3af]">Important notifications</p>
          <button
            onClick={onOpenImportance}
            className="mt-2 flex w-full items-center gap-2 rounded-lg border border-[#e5e7eb] px-3 py-2.5 text-left hover:bg-[#f9fafb]"
          >
            <SlidersHorizontal size={15} className="shrink-0 text-[#6b7280]" />
            <span className="flex-1 text-[13px] text-[#374151]">Customize importance</span>
            <span className="text-[12px] text-[#9ca3af]">
              {prefs.data?.important_count ?? 0}/{prefs.data?.total_count ?? 0} ›
            </span>
          </button>
        </div>

        <div className="mt-5">
          <p className="mb-2 text-[12px] font-semibold uppercase tracking-wide text-[#9ca3af]">Display mode</p>
          <div className="grid grid-cols-2 gap-2">
            <DisplayModeCard
              label="Fullscreen"
              selected={settings.display_mode === 'fullscreen'}
              onClick={() => update({ display_mode: 'fullscreen' })}
              tall
            />
            <DisplayModeCard
              label="Inline"
              selected={settings.display_mode === 'inline'}
              onClick={() => update({ display_mode: 'inline' })}
            />
          </div>
        </div>
      </div>

      <div className="space-y-1 border-t border-[#e8eaed] px-4 py-3">
        <FooterLink icon={<Settings size={14} />} label="Notification settings" onClick={onOpenNotificationSettings} />
        <FooterLink icon={<Keyboard size={14} />} label="Keyboard shortcuts" onClick={onOpenKeyboardShortcuts} />
      </div>
    </aside>
  )
}

function ToggleRow({
  icon,
  label,
  checked,
  onChange,
}: {
  icon: React.ReactNode
  label: string
  checked: boolean
  onChange: (v: boolean) => void
}) {
  return (
    <div className="flex items-center gap-2.5 py-2.5">
      <span className="w-5 shrink-0 text-[#6b7280]">{icon}</span>
      <span className="flex-1 text-[13px] text-[#374151]">{label}</span>
      <InboxToggle checked={checked} onChange={onChange} accent="amber" />
    </div>
  )
}

function DisplayModeCard({
  label,
  selected,
  onClick,
  tall,
}: {
  label: string
  selected: boolean
  onClick: () => void
  tall?: boolean
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        'relative rounded-lg border p-2 text-left transition-colors',
        selected ? 'border-[#c4a574] bg-[#faf6f0]' : 'border-[#e5e7eb] hover:bg-[#f9fafb]',
      )}
    >
      {selected && (
        <span className="absolute right-2 top-2 flex h-4 w-4 items-center justify-center rounded-full bg-[#c4a574] text-white">
          <Check size={10} />
        </span>
      )}
      <div className={cn('mb-2 rounded bg-[#f3f4f6]', tall ? 'h-16' : 'h-10')} />
      <span className="text-[12px] font-medium text-[#374151]">{label}</span>
    </button>
  )
}

function FooterLink({
  icon,
  label,
  onClick,
}: {
  icon: React.ReactNode
  label: string
  onClick: () => void
}) {
  return (
    <button
      onClick={onClick}
      className="flex w-full items-center gap-2 rounded-md px-1 py-2 text-[13px] text-[#4b5563] hover:bg-[#f9fafb]"
    >
      {icon}
      {label}
    </button>
  )
}
