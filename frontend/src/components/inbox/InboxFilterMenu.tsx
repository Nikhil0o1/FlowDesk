import { AtSign, Bell, CheckSquare, Clock3 } from 'lucide-react'
import { useEffect, useRef } from 'react'

import type { InboxFilter, InboxSummary } from '../../lib/types'
import { cn } from '../../lib/utils'

const FILTERS: { id: InboxFilter; label: string; icon: typeof AtSign; countKey: keyof InboxSummary }[] = [
  { id: 'mentions', label: '@ Mentions', icon: AtSign, countKey: 'mentions' },
  { id: 'assigned', label: '@ Assigned to me', icon: CheckSquare, countKey: 'assigned_to_me' },
  { id: 'unread', label: 'Unread', icon: Bell, countKey: 'unread' },
  { id: 'reminders', label: 'Reminders', icon: Clock3, countKey: 'reminders' },
]

export function InboxFilterMenu({
  summary,
  active,
  onSelect,
  onClose,
}: {
  summary?: InboxSummary
  active: InboxFilter | null
  onSelect: (filter: InboxFilter | null) => void
  onClose: () => void
}) {
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose()
    }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [onClose])

  return (
    <div
      ref={ref}
      className="absolute left-0 top-full z-30 mt-1 w-56 rounded-lg border border-[#e5e7eb] bg-white p-1 shadow-lg"
    >
      {FILTERS.map((item) => {
        const Icon = item.icon
        const count = summary?.[item.countKey] ?? 0
        const selected = active === item.id
        return (
          <button
            key={item.id}
            onClick={() => onSelect(selected ? null : item.id)}
            className={cn(
              'flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-left text-[13px] transition-colors',
              selected ? 'bg-[#f3f4f6] text-[#1a1d21]' : 'text-[#374151] hover:bg-[#f9fafb]',
            )}
          >
            <Icon size={14} className="text-[#6b7280]" />
            <span className="flex-1">{item.label}</span>
            <span className="text-[12px] text-[#9ca3af]">{count}</span>
          </button>
        )
      })}
    </div>
  )
}
