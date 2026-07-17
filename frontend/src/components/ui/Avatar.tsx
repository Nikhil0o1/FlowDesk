import { X } from 'lucide-react'
import { useEffect, useState } from 'react'

import { statusEmoji } from '../../lib/status'
import { resolveAvatarUrl } from '../../lib/env'
import { avatarColor, cn, initials } from '../../lib/utils'
import { usePresenceStore } from '../../lib/ws'

interface AvatarProps {
  name: string
  src?: string | null
  size?: number
  userId?: string
  showPresence?: boolean
  statusText?: string | null
  className?: string
  color?: string | null
}

export function Avatar({
  name,
  src,
  size = 28,
  userId,
  showPresence,
  statusText,
  className,
  color,
}: AvatarProps) {
  const online = usePresenceStore((s) => (userId ? s.online.has(userId) : false))
  const emoji = statusEmoji(statusText)
  const resolvedSrc = resolveAvatarUrl(src)
  const [imgError, setImgError] = useState(false)
  useEffect(() => setImgError(false), [resolvedSrc])

  const presenceSize = Math.max(8, size * 0.3)
  const statusSize = Math.max(14, size * 0.42)

  return (
    <div className={cn('relative inline-flex shrink-0', className)} style={{ width: size, height: size }}>
      {resolvedSrc && !imgError ? (
        <img
          key={resolvedSrc}
          src={resolvedSrc}
          alt={name}
          onError={() => setImgError(true)}
          className="h-full w-full rounded-full object-cover ring-1 ring-white/10"
          referrerPolicy="no-referrer"
        />
      ) : (
        <div
          className="flex h-full w-full items-center justify-center rounded-full font-semibold text-white ring-1 ring-white/10"
          style={{ backgroundColor: color || avatarColor(name || '?'), fontSize: size * 0.38 }}
        >
          {initials(name || '?')}
        </div>
      )}
      {showPresence && userId && (
        <span
          className={cn(
            'absolute z-10 rounded-full border-2 border-ink-900',
            emoji ? '-bottom-0.5 -left-0.5' : '-bottom-0.5 -right-0.5',
            online ? 'bg-emerald-400' : 'bg-red-400',
          )}
          style={{ width: presenceSize, height: presenceSize }}
        />
      )}
      {emoji && (
        <span
          className="absolute -bottom-1 -right-1 z-20 flex items-center justify-center rounded-full border-2 border-ink-900 bg-ink-850 shadow-sm"
          style={{ width: statusSize, height: statusSize, fontSize: statusSize * 0.62 }}
          title={statusText ?? undefined}
        >
          {emoji}
        </span>
      )}
    </div>
  )
}

export function AvatarStack({
  users,
  size = 24,
  max = 4,
  onRemove,
}: {
  users: { id: string; full_name: string; avatar_url: string | null }[]
  size?: number
  max?: number
  /** When set, each avatar shows a hover "x" to remove that assignee (ClickUp-style). */
  onRemove?: (userId: string) => void
}) {
  const visible = users.slice(0, max)
  const overflow = users.length - visible.length
  if (users.length === 0) return null
  const removeSize = Math.max(12, Math.round(size * 0.55))
  return (
    <div className="flex items-center -space-x-1.5">
      {visible.map((u) => (
        <div
          key={u.id}
          className="group/av relative rounded-full ring-2 ring-ink-900"
          title={u.full_name || u.id}
        >
          <Avatar name={u.full_name || u.id} src={u.avatar_url} size={size} />
          {onRemove && (
            <button
              type="button"
              aria-label={`Unassign ${u.full_name || 'user'}`}
              title={`Unassign ${u.full_name || 'user'}`}
              className="absolute -right-0.5 -top-0.5 z-20 flex items-center justify-center rounded-full bg-ink-600 text-fg opacity-0 shadow-sm ring-1 ring-ink-900 transition-opacity hover:bg-red-500 hover:text-white group-hover/av:opacity-100"
              style={{ width: removeSize, height: removeSize }}
              onClick={(e) => {
                e.preventDefault()
                e.stopPropagation()
                onRemove(u.id)
              }}
              onMouseDown={(e) => {
                // Keep the parent Dropdown from toggling open on this click.
                e.preventDefault()
                e.stopPropagation()
              }}
            >
              <X size={Math.max(8, removeSize - 4)} strokeWidth={3} />
            </button>
          )}
        </div>
      ))}
      {overflow > 0 && (
        <div
          className="flex items-center justify-center rounded-full bg-ink-700 font-medium text-fg-secondary ring-2 ring-ink-900"
          style={{ width: size, height: size, fontSize: size * 0.4 }}
          title={`${overflow} more`}
        >
          +{overflow}
        </div>
      )}
    </div>
  )
}
