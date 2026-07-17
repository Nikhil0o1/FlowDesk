import { MENTION_MARKUP_RE, renderMentions, timeAgo } from '../../../../lib/utils'
import { Avatar } from '../../../../components/ui/Avatar'
import { cn } from '../../../../lib/utils'
import type { DocComment } from '../../types/comment'

interface CommentCardProps {
  comment: DocComment
  onReply?: () => void
  onEdit?: () => void
  onDelete?: () => void
  onResolve?: () => void
  canEdit?: boolean
  canDelete?: boolean
  isReply?: boolean
  resolved?: boolean
}

/** Single comment row: avatar, name, time, body, actions. */
export function CommentCard({
  comment,
  onReply,
  onEdit,
  onDelete,
  onResolve,
  canEdit,
  canDelete,
  isReply,
  resolved,
}: CommentCardProps) {
  return (
    <article className={cn('group', isReply && 'opacity-95')}>
      <div className="flex items-start gap-2.5">
        <Avatar name={comment.authorName} size={28} userId={comment.authorId} showPresence />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-baseline gap-2">
            <span className="text-sm font-semibold text-fg">{comment.authorName}</span>
            <span className="text-[11px] text-fg-muted">{timeAgo(comment.createdAt)}</span>
            {comment.inlineAnchor && (
              <span className="rounded bg-amber-400/15 px-1.5 py-0.5 text-[10px] font-medium text-amber-300">Inline</span>
            )}
            {resolved && (
              <span className="rounded bg-emerald-500/15 px-1.5 py-0.5 text-[10px] font-medium text-emerald-300">Resolved</span>
            )}
          </div>
          {comment.inlineAnchor && (
            <blockquote className="my-1 border-l-2 border-brand/40 pl-2 text-xs italic text-fg-muted">
              “{comment.inlineAnchor.quote}”
            </blockquote>
          )}
          <p className="whitespace-pre-wrap text-sm leading-relaxed text-fg-secondary">{renderMentionsJsx(comment.body)}</p>
          {canEdit && (
            <div className="mt-1 flex flex-wrap items-center gap-3 opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
              {onReply && (
                <button type="button" className="text-xs text-fg-muted hover:text-fg" onClick={onReply}>
                  Reply
                </button>
              )}
              {onResolve && (
                <button type="button" className="text-xs text-fg-muted hover:text-fg" onClick={onResolve}>
                  {resolved ? 'Unresolve' : 'Resolve'}
                </button>
              )}
              {onEdit && (
                <button type="button" className="text-xs text-fg-muted hover:text-fg" onClick={onEdit}>
                  Edit
                </button>
              )}
              {canDelete && onDelete && (
                <button type="button" className="text-xs text-fg-muted hover:text-rose-400" onClick={onDelete}>
                  Delete
                </button>
              )}
            </div>
          )}
        </div>
      </div>
    </article>
  )
}

function renderMentionsJsx(body: string): React.ReactNode {
  const parts: React.ReactNode[] = []
  const regex = new RegExp(MENTION_MARKUP_RE.source, 'g')
  let lastIndex = 0
  let match: RegExpExecArray | null
  let key = 0
  while ((match = regex.exec(body)) !== null) {
    if (match.index > lastIndex) parts.push(body.slice(lastIndex, match.index))
    parts.push(
      <span key={key++} className="rounded bg-brand-soft px-1 font-medium text-brand">
        @{match[1]}
      </span>,
    )
    lastIndex = match.index + match[0].length
  }
  if (lastIndex < body.length) parts.push(body.slice(lastIndex))
  return parts.length > 0 ? parts : renderMentions(body)
}
