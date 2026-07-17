// @refresh reset
import { AlertCircle, CheckCircle2, Info, X } from 'lucide-react'

import { useToastStore } from '../../stores/toast'
import { cn } from '../../lib/utils'

const ICONS = {
  success: <CheckCircle2 size={16} className="text-emerald-400" />,
  error: <AlertCircle size={16} className="text-red-400" />,
  info: <Info size={16} className="text-sky-400" />,
}

export function Toasts() {
  const { toasts, dismiss } = useToastStore()
  if (toasts.length === 0) return null
  return (
    <div className="fixed bottom-5 right-5 z-[100] flex w-80 flex-col gap-2">
      {toasts.map((t) => (
        <div
          key={t.id}
          className={cn(
            'flex items-start gap-2.5 rounded-xl border border-ink-700 bg-ink-850 px-4 py-3 shadow-popover',
          )}
        >
          <div className="mt-0.5 shrink-0">{ICONS[t.kind]}</div>
          <p className="flex-1 text-sm text-fg">{t.message}</p>
          <button
            onClick={() => dismiss(t.id)}
            className="shrink-0 text-fg-muted transition-colors hover:text-fg"
          >
            <X size={14} />
          </button>
        </div>
      ))}
    </div>
  )
}
