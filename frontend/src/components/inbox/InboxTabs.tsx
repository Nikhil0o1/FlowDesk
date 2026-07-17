import {
  Activity,
  Briefcase,
  CheckCheck,
  Clock3,
} from 'lucide-react'

import type { InboxSettings, InboxTab } from '../../lib/types'
import { cn } from '../../lib/utils'

const TABS: { id: InboxTab; label: string; icon: typeof Briefcase }[] = [
  { id: 'primary', label: 'Primary', icon: Briefcase },
  { id: 'other', label: 'Other', icon: Activity },
  { id: 'later', label: 'Later', icon: Clock3 },
  { id: 'cleared', label: 'Cleared', icon: CheckCheck },
]

export function InboxTabs({
  active,
  onChange,
  settings,
}: {
  active: InboxTab
  onChange: (tab: InboxTab) => void
  settings?: InboxSettings
}) {
  const tabs = settings?.show_all_tab
    ? [{ id: 'all' as InboxTab, label: 'All', icon: Briefcase }, ...TABS]
    : TABS

  return (
    <div className="border-b border-[#e8eaed] bg-white">
      <div
        className="grid items-end"
        style={{ gridTemplateColumns: `repeat(${tabs.length}, minmax(0, 1fr))` }}
      >
        {tabs.map((tab) => {
          const Icon = tab.icon
          const selected = active === tab.id
          return (
            <button
              key={tab.id}
              onClick={() => onChange(tab.id)}
              className={cn(
                'relative flex items-center justify-center gap-1.5 py-3 text-[13px] font-medium transition-colors',
                selected ? 'text-[#1a1d21]' : 'text-[#6b7280] hover:text-[#374151]',
              )}
            >
              <Icon size={14} strokeWidth={selected ? 2.25 : 1.75} />
              {tab.label}
              {selected && (
                <span className="absolute inset-x-4 -bottom-px h-[2px] rounded-full bg-[#1a1d21]" />
              )}
            </button>
          )
        })}
      </div>
    </div>
  )
}
