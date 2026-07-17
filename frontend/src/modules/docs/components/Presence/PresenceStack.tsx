import { Avatar } from '../../../../components/ui/Avatar'
import type { DocViewer } from '../../types/presence'

/** Avatar stack of users currently viewing the document. */
export function PresenceStack({ viewers, max = 4 }: { viewers: DocViewer[]; max?: number }) {
  if (viewers.length === 0) return null

  const shown = viewers.slice(0, max)
  const extra = viewers.length - shown.length

  return (
    <div className="flex items-center gap-1" title={viewers.map((v) => v.name).join(', ')}>
      <div className="flex -space-x-2">
        {shown.map((v) => (
          <Avatar key={v.userId} name={v.name} src={v.avatarUrl} color={v.avatarColor} size={26} userId={v.userId} showPresence />
        ))}
      </div>
      {extra > 0 && <span className="text-xs text-fg-muted">+{extra}</span>}
    </div>
  )
}
