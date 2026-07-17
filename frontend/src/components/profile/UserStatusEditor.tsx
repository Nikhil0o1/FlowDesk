import { SmilePlus, X } from 'lucide-react'
import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'

import { buildStatus, parseStatus, STATUS_PRESETS } from '../../lib/status'
import { cn } from '../../lib/utils'

interface UserStatusEditorProps {
  value: string | null | undefined
  onSave: (status: string | null) => void | Promise<void>
  compact?: boolean
}

export function UserStatusEditor({ value, onSave, compact }: UserStatusEditorProps) {
  const parsed = parseStatus(value)
  const [open, setOpen] = useState(false)
  const [customText, setCustomText] = useState(parsed.text)
  const [selectedEmoji, setSelectedEmoji] = useState(parsed.emoji)

  useEffect(() => {
    const next = parseStatus(value)
    setCustomText(next.text)
    setSelectedEmoji(next.emoji)
  }, [value])

  const applyPreset = (emoji: string, label: string) => {
    const next = buildStatus(emoji, label)
    setSelectedEmoji(emoji)
    setCustomText(label)
    void onSave(next)
    setOpen(false)
  }

  const applyCustom = () => {
    const text = customText.trim()
    if (!text && !selectedEmoji) {
      void onSave(null)
      setOpen(false)
      return
    }
    void onSave(buildStatus(selectedEmoji, text))
    setOpen(false)
  }

  const clear = () => {
    setCustomText('')
    setSelectedEmoji('')
    void onSave(null)
    setOpen(false)
  }

  const trigger = compact ? (
    <button
      type="button"
      className="menu-item"
      onClick={() => setOpen(true)}
    >
      <SmilePlus size={15} />
      {parsed.text || parsed.emoji ? 'Update status' : 'Set a status'}
    </button>
  ) : (
    <button
      type="button"
      onClick={() => setOpen(true)}
      className={cn(
        'flex w-full items-center gap-3 rounded-xl border border-ink-700 bg-ink-850 px-4 py-3 text-left transition-colors hover:border-ink-600 hover:bg-ink-800',
        (parsed.emoji || parsed.text) && 'border-brand/30',
      )}
    >
      <span className="text-xl">{parsed.emoji || '😊'}</span>
      <span className="min-w-0 flex-1 text-sm text-fg-secondary">
        {parsed.text || "What's your status?"}
      </span>
      <span className="text-xs font-medium text-brand">Edit</span>
    </button>
  )

  if (!open) return trigger

  return (
    <>
      {trigger}
      {createPortal(
        <>
          <div className="fixed inset-0 z-[100] bg-black/50" onClick={() => setOpen(false)} />
          <div className="fixed left-1/2 top-1/2 z-[101] w-[380px] -translate-x-1/2 -translate-y-1/2 rounded-2xl border border-ink-700 bg-ink-900 shadow-2xl">
            {/* Header */}
            <div className="flex items-center justify-between border-b border-ink-700 px-5 py-4">
              <h2 className="text-base font-semibold text-fg">Edit status</h2>
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="rounded-lg p-1 text-fg-muted transition-colors hover:bg-ink-750 hover:text-fg"
              >
                <X size={18} />
              </button>
            </div>

            <div className="p-5">
              {/* Custom status input */}
              <div className="flex items-center gap-3 rounded-xl border border-ink-700 bg-ink-850 px-3 py-2.5">
                <button
                  type="button"
                  onClick={() => {
                    const emojis = ['😊', '😎', '🎯', '💪', '🔥', '✨', '🚀', '💻']
                    const current = emojis.indexOf(selectedEmoji)
                    setSelectedEmoji(emojis[(current + 1) % emojis.length])
                  }}
                  className="flex h-9 w-9 items-center justify-center rounded-lg bg-ink-750 text-xl transition-colors hover:bg-ink-700"
                  title="Change emoji"
                >
                  {selectedEmoji || '😊'}
                </button>
                <input
                  value={customText}
                  onChange={(e) => setCustomText(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && applyCustom()}
                  placeholder="What's on your mind?"
                  className="min-w-0 flex-1 bg-transparent text-sm text-fg outline-none placeholder:text-fg-muted"
                  maxLength={100}
                  autoFocus
                />
              </div>

              {/* Recents - only show if there's a current status */}
              {(parsed.emoji || parsed.text) && (
                <div className="mt-5">
                  <p className="mb-2 text-xs font-medium text-fg-muted">Current</p>
                  <button
                    type="button"
                    onClick={clear}
                    className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left transition-colors hover:bg-ink-800"
                  >
                    <span className="text-lg">{parsed.emoji || '💬'}</span>
                    <span className="flex-1 text-sm text-fg">{parsed.text || 'Status set'}</span>
                    <span className="text-[11px] text-fg-muted">Clear</span>
                  </button>
                </div>
              )}

              {/* Preset statuses */}
              <div className="mt-5">
                <p className="mb-2 text-xs font-medium text-fg-muted">Set a status</p>
                <div className="grid grid-cols-2 gap-1">
                  {STATUS_PRESETS.map((preset) => (
                    <button
                      key={preset.label}
                      type="button"
                      className="flex items-center gap-2.5 rounded-lg px-3 py-2.5 text-left transition-colors hover:bg-ink-800"
                      onClick={() => applyPreset(preset.emoji, preset.label)}
                    >
                      <span className="text-lg">{preset.emoji}</span>
                      <span className="truncate text-sm text-fg-secondary">{preset.label}</span>
                    </button>
                  ))}
                </div>
              </div>
            </div>

            {/* Footer */}
            <div className="border-t border-ink-700 px-5 py-4">
              <button
                type="button"
                className="w-full rounded-xl bg-gradient-to-r from-brand to-[#07BEA3] py-2.5 text-sm font-semibold text-white transition-opacity hover:opacity-90"
                onClick={applyCustom}
              >
                Save
              </button>
            </div>
          </div>
        </>,
        document.body,
      )}
    </>
  )
}

export function UserStatusLine({ status }: { status: string | null | undefined }) {
  const parsed = parseStatus(status)
  if (!parsed.emoji && !parsed.text) return null
  return (
    <p className="mt-0.5 flex items-center gap-1.5 truncate text-xs text-fg-secondary">
      <span className="shrink-0 text-sm leading-none">{parsed.emoji || '💬'}</span>
      <span className="truncate">{parsed.text}</span>
    </p>
  )
}
