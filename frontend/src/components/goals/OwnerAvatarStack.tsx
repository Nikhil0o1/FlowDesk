import type { UserBrief } from '../../lib/types'
import { Avatar } from '../ui/Avatar'

/** Overlapping owner avatars (ClickUp-style stack). */
export function OwnerAvatarStack({
  owners,
  size = 22,
  max = 3,
}: {
  owners: UserBrief[]
  size?: number
  max?: number
}) {
  if (owners.length === 0) {
    return <span className="rounded-full bg-ink-750" style={{ width: size, height: size }} />
  }
  const shown = owners.slice(0, max)
  const extra = owners.length - shown.length
  return (
    <div className="flex items-center">
      {shown.map((owner, i) => (
        <div
          key={owner.id}
          className="rounded-full ring-2 ring-ink-800"
          style={{ marginLeft: i === 0 ? 0 : -Math.round(size * 0.35), zIndex: shown.length - i }}
          title={owner.full_name || owner.email}
        >
          <Avatar
            name={owner.full_name || owner.email}
            src={owner.avatar_url}
            color={owner.avatar_color}
            size={size}
          />
        </div>
      ))}
      {extra > 0 && (
        <span
          className="ml-1 text-[10px] font-semibold text-fg-muted"
          title={owners
            .slice(max)
            .map((o) => o.full_name || o.email)
            .join(', ')}
        >
          +{extra}
        </span>
      )}
    </div>
  )
}
