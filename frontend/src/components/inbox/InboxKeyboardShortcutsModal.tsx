import {
  Command,
  Inbox,
  X,
} from 'lucide-react'
import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'

import { buildInboxShortcutCategories, type ShortcutKey } from '../../lib/inboxShortcuts'
import { modKeyLabel } from '../../lib/keyboard'
import { cn } from '../../lib/utils'

export function InboxKeyboardShortcutsModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [activeCategory, setActiveCategory] = useState('inbox')
  const mod = modKeyLabel()
  const categories = buildInboxShortcutCategories(mod)
  const current = categories.find((c) => c.id === activeCategory) ?? categories[0]

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        onClose()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  if (!open) return null

  return createPortal(
    <div
      className="fixed inset-0 z-[70] flex items-center justify-center bg-black/40 p-6"
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className="flex h-[min(720px,90vh)] w-full max-w-4xl overflow-hidden rounded-2xl border border-[#e8eaed] bg-white shadow-2xl">
        <aside className="flex w-[220px] shrink-0 flex-col border-r border-[#e8eaed] bg-[#fafafa]">
          <div className="flex items-center gap-2 border-b border-[#e8eaed] px-4 py-4">
            <Command size={16} className="text-[#6b7280]" />
            <h2 className="text-[15px] font-semibold text-[#1a1d21]">Keyboard Shortcuts</h2>
          </div>
          <nav className="flex-1 overflow-y-auto p-2">
            {categories.map((category) => (
              <button
                key={category.id}
                onClick={() => setActiveCategory(category.id)}
                className={cn(
                  'mb-0.5 flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-[13px] transition-colors',
                  activeCategory === category.id
                    ? 'bg-[#faf0ea] font-medium text-[#1a1d21]'
                    : 'text-[#4b5563] hover:bg-white',
                )}
              >
                {category.id === 'inbox' ? <Inbox size={14} /> : <Command size={14} />}
                {category.label}
              </button>
            ))}
          </nav>
          <p className="border-t border-[#e8eaed] px-4 py-3 text-[11px] leading-relaxed text-[#9ca3af]">
            Shortcuts work on the inbox list. Press Esc to close this dialog.
          </p>
        </aside>

        <div className="flex min-w-0 flex-1 flex-col">
          <div className="flex items-center justify-between border-b border-[#e8eaed] px-6 py-4">
            <div className="flex items-center gap-2">
              {current.id === 'inbox' ? <Inbox size={18} /> : <Command size={18} />}
              <h3 className="text-[18px] font-semibold text-[#1a1d21]">{current.label}</h3>
            </div>
            <button onClick={onClose} className="rounded-lg p-1.5 text-[#6b7280] hover:bg-[#f3f4f6]">
              <X size={18} />
            </button>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5">
            {current.sections.map((section) => (
              <div key={section.title} className="mb-8">
                <h4 className="text-[15px] font-semibold text-[#1a1d21]">{section.title}</h4>
                {section.subtitle && (
                  <p className="mt-1 text-[13px] text-[#9ca3af]">{section.subtitle}</p>
                )}
                <ul className="mt-4 space-y-3">
                  {section.items.map((item, idx) => (
                    <li key={`${section.title}-${idx}`} className="flex items-center justify-between gap-4">
                      <span className="text-[14px] text-[#374151]">{item.description}</span>
                      <span className="flex shrink-0 items-center gap-1">
                        {item.keys.map((key, keyIdx) => (
                          <ShortcutKeyBadge key={`${keyIdx}-${typeof key === 'string' ? key : key.label}`} value={key} />
                        ))}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>,
    document.body,
  )
}

function ShortcutKeyBadge({ value }: { value: ShortcutKey }) {
  if (typeof value === 'string') {
    return (
      <kbd className="inline-flex min-w-[28px] items-center justify-center rounded-md border border-[#e5e7eb] bg-[#f9fafb] px-2 py-1 text-[12px] font-medium text-[#4b5563]">
        {value}
      </kbd>
    )
  }

  if (value.icon === 'shift') {
    return (
      <kbd className="inline-flex h-7 w-7 items-center justify-center rounded-md border border-[#e5e7eb] bg-[#f9fafb] text-[12px] font-medium text-[#4b5563]">
        ↑
      </kbd>
    )
  }

  return (
    <kbd className="inline-flex min-w-[28px] items-center justify-center rounded-md border border-[#e5e7eb] bg-[#f9fafb] px-2 py-1 text-[12px] font-medium text-[#4b5563]">
      {value.label}
    </kbd>
  )
}
