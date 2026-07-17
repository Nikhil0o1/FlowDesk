import { Check, Copy } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'

import type { EphemeralOAuthSecret } from '../../../lib/oauthApps'
import { cn } from '../../../lib/utils'
import { Modal } from '../../ui/Modal'

function maskSecret(raw: string): string {
  if (raw.length <= 12) return '•'.repeat(Math.max(raw.length, 8))
  return `${raw.slice(0, 10)}${'•'.repeat(28)}${raw.slice(-4)}`
}

/**
 * One-time client secret reveal. After a successful secret copy, the secret is masked
 * and Copy is permanently disabled for that field.
 */
export function OAuthSecretRevealDialog({
  secret,
  onClose,
}: {
  secret: EphemeralOAuthSecret
  onClose: () => void
}) {
  const [copiedId, setCopiedId] = useState(false)
  const [secretCopied, setSecretCopied] = useState(false)
  const [envCopied, setEnvCopied] = useState(false)
  const [acked, setAcked] = useState(false)
  const secretRef = useRef(secret.clientSecret)

  useEffect(() => {
    secretRef.current = secret.clientSecret
    return () => {
      secretRef.current = ''
    }
  }, [secret.clientSecret])

  const copyId = async () => {
    try {
      await navigator.clipboard.writeText(secret.clientId)
      setCopiedId(true)
    } catch {
      /* ignore */
    }
  }

  const copySecret = async () => {
    if (secretCopied) return
    const value = secretRef.current
    if (!value) return
    try {
      await navigator.clipboard.writeText(value)
      secretRef.current = ''
      setSecretCopied(true)
    } catch {
      /* allow retry while still visible */
    }
  }

  const copyEnv = async () => {
    if (secretCopied) {
      // Env block contains the secret — only allow before secret was locked, or strip after
      return
    }
    try {
      await navigator.clipboard.writeText(secret.envSnippet)
      setEnvCopied(true)
      // Env copy also exposes the secret — lock secret field the same way
      secretRef.current = ''
      setSecretCopied(true)
    } catch {
      /* ignore */
    }
  }

  const finish = () => {
    if (!acked) return
    secretRef.current = ''
    onClose()
  }

  return (
    <Modal
      open
      title={secret.reason === 'regenerated' ? 'Save your new client secret' : 'App Created'}
      onClose={() => {
        if (!acked) return
        finish()
      }}
      width="max-w-lg"
      closeOnBackdrop={false}
      closeOnEscape={false}
    >
      <p className="text-sm text-fg-secondary">
        Copy the client secret now — it will not be shown again. After you copy it, Copy is disabled
        and the secret is masked.
      </p>

      <label className="mt-4 block text-xs font-medium text-fg-muted">Client ID</label>
      <div className="mt-1 flex items-center gap-2 rounded-lg border border-ink-700 bg-ink-900 p-3">
        <code className="flex-1 break-all font-mono text-xs text-fg">{secret.clientId}</code>
        <button
          type="button"
          className="btn-ghost shrink-0 p-2"
          onClick={() => void copyId()}
          aria-label="Copy client ID"
        >
          {copiedId ? <Check size={16} className="text-emerald-400" /> : <Copy size={16} />}
        </button>
      </div>

      <label className="mt-3 block text-xs font-medium text-fg-muted">Client Secret</label>
      <div className="mt-1 flex items-center gap-2 rounded-lg border border-ink-700 bg-ink-900 p-3">
        <code
          className={cn(
            'flex-1 break-all font-mono text-xs text-fg',
            secretCopied && 'select-none text-fg-muted',
          )}
          data-private
          data-clarity-mask="true"
          data-sentry-mask
        >
          {secretCopied ? maskSecret(secret.clientSecret) : secret.clientSecret}
        </code>
        <button
          type="button"
          className={cn(
            'inline-flex shrink-0 items-center gap-1.5 rounded-md px-2 py-1.5 text-xs font-medium',
            secretCopied ? 'cursor-not-allowed text-emerald-400' : 'btn-ghost',
          )}
          onClick={() => void copySecret()}
          disabled={secretCopied}
          aria-label={secretCopied ? 'Client secret already copied' : 'Copy client secret'}
        >
          {secretCopied ? (
            <>
              <Check size={16} />
              Copied
            </>
          ) : (
            <Copy size={16} />
          )}
        </button>
      </div>

      <label className="mt-3 block text-xs font-medium text-fg-muted">Environment variables</label>
      <div className="mt-1 rounded-lg border border-ink-700 bg-ink-950 p-3">
        <pre
          className={cn(
            'overflow-x-auto whitespace-pre-wrap font-mono text-[11px] leading-relaxed text-fg',
            secretCopied && 'select-none text-fg-muted',
          )}
        >
          {secretCopied
            ? secret.envSnippet.replace(secret.clientSecret, maskSecret(secret.clientSecret))
            : secret.envSnippet}
        </pre>
        <button
          type="button"
          className={cn(
            'mt-2 inline-flex items-center gap-1.5 rounded-md border border-ink-600 px-3 py-1.5 text-xs font-medium',
            secretCopied
              ? 'cursor-not-allowed text-fg-muted opacity-60'
              : 'text-fg hover:bg-ink-800',
          )}
          onClick={() => void copyEnv()}
          disabled={secretCopied}
        >
          {envCopied || secretCopied ? <Check size={14} /> : <Copy size={14} />}
          {secretCopied ? 'Secret locked' : 'Copy env block'}
        </button>
      </div>

      <p className="mt-3 text-xs text-fg-muted">
        Token URL: <code className="font-mono">{secret.tokenUrl}</code>
      </p>

      <label className="mt-4 flex cursor-pointer items-start gap-2 text-sm text-fg">
        <input
          type="checkbox"
          className="mt-0.5"
          checked={acked}
          onChange={(e) => setAcked(e.target.checked)}
        />
        <span>I have saved these credentials in a secure place</span>
      </label>

      <button
        type="button"
        className={cn('btn-primary mt-4 w-full', !acked && 'opacity-60')}
        disabled={!acked}
        onClick={finish}
      >
        Done
      </button>
    </Modal>
  )
}
