import { Check, Copy } from 'lucide-react'
import { useEffect, useId, useRef, useState } from 'react'

import type { EphemeralSecret } from '../../../lib/apiKeys'
import { api } from '../../../lib/api'
import { cn } from '../../../lib/utils'
import { Modal } from '../../ui/Modal'

function maskRawSecret(raw: string): string {
  if (raw.length <= 12) return '•'.repeat(Math.max(raw.length, 8))
  return `${raw.slice(0, 8)}${'•'.repeat(24)}${raw.slice(-4)}`
}

/**
 * One-time secret display. The raw key lives only in React state for this dialog.
 * After a successful clipboard copy the secret is masked and Copy is permanently disabled.
 * Never write to localStorage / sessionStorage / URL.
 */
export function SecretRevealDialog({
  secret,
  docsHref = '/app/developers/authentication',
  onAcknowledgedClose,
}: {
  secret: EphemeralSecret
  docsHref?: string
  onAcknowledgedClose: () => void
}) {
  const [hasCopied, setHasCopied] = useState(false)
  const [acked, setAcked] = useState(false)
  const [confirmClose, setConfirmClose] = useState(false)
  const [closing, setClosing] = useState(false)
  const [copyError, setCopyError] = useState(false)
  const liveRef = useRef<HTMLDivElement>(null)
  const announceId = useId()
  /** Cleared after successful copy so the full secret cannot be re-read from the DOM. */
  const rawRef = useRef(secret.raw)

  useEffect(() => {
    rawRef.current = secret.raw
    return () => {
      rawRef.current = ''
    }
  }, [secret.raw])

  const copy = async () => {
    if (hasCopied || closing) return
    const value = rawRef.current
    if (!value) return
    try {
      await navigator.clipboard.writeText(value)
      rawRef.current = ''
      setHasCopied(true)
      setCopyError(false)
      if (liveRef.current) liveRef.current.textContent = 'API key copied. Copy is now disabled.'
    } catch {
      setCopyError(true)
      const el = document.getElementById('api-key-secret-value')
      if (el) {
        const range = document.createRange()
        range.selectNodeContents(el)
        const sel = window.getSelection()
        sel?.removeAllRanges()
        sel?.addRange(range)
      }
      if (liveRef.current) {
        liveRef.current.textContent =
          'Could not copy automatically — key text is selected for a single manual copy'
      }
    }
  }

  const finish = async () => {
    if (!acked || closing) return
    setClosing(true)
    rawRef.current = ''
    try {
      // Audit only — never send the secret
      await api.post(`/users/me/api-tokens/${secret.tokenId}/usage/ack-copied`)
    } catch {
      // Non-blocking: user already saved the key; timeline ack is best-effort
    }
    onAcknowledgedClose()
  }

  const requestClose = () => {
    if (!acked) {
      setConfirmClose(true)
      return
    }
    void finish()
  }

  const displayed = hasCopied ? maskRawSecret(secret.raw) : secret.raw

  return (
    <Modal
      open
      title={secret.reason === 'rotated' ? 'Save your new API key' : 'Save your API key'}
      onClose={requestClose}
      width="max-w-lg"
      closeOnBackdrop={false}
      closeOnEscape={false}
      hideCloseButton={false}
    >
      <div className="space-y-4">
        <p className="text-sm text-fg-secondary">
          Copy the key for <span className="font-medium text-fg">{secret.keyName}</span> now.
          FlowDesk cannot show it again. After you copy, Copy is disabled and the key is masked.
        </p>

        <div
          className="rounded-lg border border-amber-600/50 bg-amber-500/15 px-3 py-2 text-sm text-amber-950 dark:border-amber-500/40 dark:text-amber-100"
          role="status"
        >
          This is the only time the full key is displayed. Store it in a secrets manager — never in
          git, browser code, or chat.
        </div>

        <div className="flex items-start gap-2 rounded-lg border border-ink-700 bg-ink-900 p-3">
          <code
            id="api-key-secret-value"
            className={cn(
              'flex-1 break-all font-mono text-xs text-fg',
              hasCopied && 'select-none text-fg-muted',
            )}
            data-private
            data-clarity-mask="true"
            data-sentry-mask
          >
            {displayed}
          </code>
          <button
            type="button"
            className={cn(
              'inline-flex shrink-0 items-center gap-1.5 rounded-md px-2.5 py-2 text-xs font-medium',
              hasCopied
                ? 'cursor-not-allowed text-emerald-400'
                : 'btn-ghost hover:bg-ink-800',
            )}
            onClick={() => void copy()}
            disabled={hasCopied || closing}
            aria-label={hasCopied ? 'API key already copied' : 'Copy API key'}
          >
            {hasCopied ? (
              <>
                <Check size={16} />
                Copied
              </>
            ) : (
              <>
                <Copy size={16} />
                Copy
              </>
            )}
          </button>
        </div>

        {copyError && !hasCopied && (
          <p className="text-xs text-amber-400" role="alert">
            Automatic copy failed. Select the key above once, paste it into your secrets manager,
            then confirm below.
          </p>
        )}

        {hasCopied && (
          <p className="text-xs text-fg-muted" role="status">
            Key masked. Copy is locked for this session. If you lose it, regenerate a new key.
          </p>
        )}

        <div ref={liveRef} id={announceId} className="sr-only" aria-live="polite" />

        <label className="flex cursor-pointer items-start gap-2 text-sm text-fg">
          <input
            type="checkbox"
            className="mt-0.5"
            checked={acked}
            onChange={(e) => {
              setAcked(e.target.checked)
              setConfirmClose(false)
            }}
          />
          <span>I have saved this key in a secure place</span>
        </label>

        {confirmClose && !acked && (
          <p className="text-sm text-red-400" role="alert">
            Confirm you have saved the key before closing. FlowDesk cannot show it again.
          </p>
        )}

        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <a href={docsHref} className="text-sm text-brand hover:underline">
            Authentication documentation
          </a>
          <button
            type="button"
            className={cn('btn-primary', !acked && 'opacity-60')}
            disabled={!acked || closing}
            onClick={() => void finish()}
          >
            Done
          </button>
        </div>
      </div>
    </Modal>
  )
}
