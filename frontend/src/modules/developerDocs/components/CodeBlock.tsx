import { Check, Copy } from 'lucide-react'
import { useId, useRef, useState } from 'react'

import { cn } from '../../../lib/utils'

export function CodeBlock({
  code,
  label,
  language = 'bash',
}: {
  code: string
  label?: string
  language?: string
}) {
  const [copied, setCopied] = useState(false)
  const liveRef = useRef<HTMLDivElement>(null)
  const announceId = useId()

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(code)
      setCopied(true)
      if (liveRef.current) liveRef.current.textContent = 'Code copied'
      window.setTimeout(() => setCopied(false), 2000)
    } catch {
      if (liveRef.current) liveRef.current.textContent = 'Copy failed — select the code manually'
    }
  }

  return (
    <div className="overflow-hidden rounded-lg border border-ink-700 bg-ink-900">
      <div className="flex items-center justify-between border-b border-ink-700 px-3 py-1.5">
        <span className="text-xs text-fg-muted">
          {label ?? language}
        </span>
        <button
          type="button"
          className="btn-ghost inline-flex items-center gap-1 px-2 py-1 text-xs"
          onClick={copy}
          aria-label="Copy code"
        >
          {copied ? <Check size={14} className="text-emerald-400" /> : <Copy size={14} />}
          {copied ? 'Copied' : 'Copy'}
        </button>
      </div>
      <pre className={cn('overflow-x-auto p-3 font-mono text-xs leading-relaxed text-fg')}>
        <code>{code}</code>
      </pre>
      <div ref={liveRef} id={announceId} className="sr-only" aria-live="polite" />
    </div>
  )
}
