import { avatarColor, cn, initials } from '../../lib/utils'
import { usePresenceStore } from '../../lib/ws'

interface AvatarProps {
  name: string
  src?: string | null
  size?: number
  userId?: string
  showPresence?: boolean
  className?: string
  /** Explicit background color (user-chosen); falls back to a name-hash color. */
  color?: string | null
}

export function Avatar({ name, src, size = 28, userId, showPresence, className, color }: AvatarProps) {
  const online = usePresenceStore((s) => (userId ? s.online.has(userId) : false))
  return (
    <div className={cn('relative inline-flex shrink-0', className)} style={{ width: size, height: size }}>
      {src ? (
        <img
          src={src}
          alt={name}
          className="h-full w-full rounded-full object-cover"
          referrerPolicy="no-referrer"
        />
      ) : (
        <div
          className="flex h-full w-full items-center justify-center rounded-full font-semibold text-white"
          style={{ backgroundColor: color || avatarColor(name || '?'), fontSize: size * 0.38 }}
        >
          {initials(name || '?')}
        </div>
      )}
      {showPresence && userId && (
        <span
          className={cn(
            'absolute -bottom-0.5 -right-0.5 rounded-full border-2 border-ink-900',
            online ? 'bg-emerald-400' : 'bg-ink-600',
          )}
          style={{ width: size * 0.32, height: size * 0.32 }}
        />
      )}
    </div>
  )
}

export function AvatarStack({ users, size = 24, max = 4 }: { users: { id: string; full_name: string; avatar_url: string | null }[]; size?: number; max?: number }) {
  const visible = users.slice(0, max)
  const overflow = users.length - visible.length
  if (users.length === 0) return null
  return (
    <div className="flex items-center -space-x-1.5">
      {visible.map((u) => (
        <div key={u.id} className="rounded-full ring-2 ring-ink-900">
          <Avatar name={u.full_name || u.id} src={u.avatar_url} size={size} />
        </div>
      ))}
      {overflow > 0 && (
        <div
          className="flex items-center justify-center rounded-full bg-ink-700 font-medium text-fg-secondary ring-2 ring-ink-900"
          style={{ width: size, height: size, fontSize: size * 0.4 }}
        >
          +{overflow}
        </div>
      )}
    </div>
  )
}
