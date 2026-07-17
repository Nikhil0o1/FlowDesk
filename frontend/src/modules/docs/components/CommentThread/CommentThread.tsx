import { useState } from 'react'
import { ChevronDown, ChevronRight, MessageSquare } from 'lucide-react'

import { cn } from '../../../../lib/utils'
import type { DocComment } from '../../types/comment'
import { CommentCard } from '../Comments/CommentCard'

interface CommentThreadProps {
  thread: DocComment
  replies: DocComment[]
  canEdit: boolean
  currentUserId: string
  onReply: (parent: DocComment) => void
  onResolve: (id: string, resolved: boolean) => void
  onDelete: (id: string) => void
}

/** Thread with collapsible replies and resolve state. */
export function CommentThread({ thread, replies, canEdit, currentUserId, onReply, onResolve, onDelete }: CommentThreadProps) {
  const [expanded, setExpanded] = useState(true)

  return (
    <div className={cn('rounded-lg border border-ink-700/80 bg-ink-900/40 p-3', thread.resolved && 'opacity-75')}>
      <CommentCard
        comment={thread}
        canEdit={canEdit}
        canDelete={thread.authorId === currentUserId}
        resolved={thread.resolved}
        onReply={() => onReply(thread)}
        onResolve={() => onResolve(thread.id, !thread.resolved)}
        onDelete={() => onDelete(thread.id)}
      />
      {replies.length > 0 && (
        <div className="mt-3">
          <button
            type="button"
            onClick={() => setExpanded((v) => !v)}
            className="mb-2 flex items-center gap-1 text-xs text-fg-muted hover:text-fg"
          >
            {expanded ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
            <MessageSquare size={12} /> {replies.length} {replies.length === 1 ? 'reply' : 'replies'}
          </button>
          {expanded && (
            <div className="ml-4 space-y-3 border-l border-ink-700 pl-3">
              {replies.map((r) => (
                <CommentCard
                  key={r.id}
                  comment={r}
                  isReply
                  canEdit={canEdit}
                  canDelete={r.authorId === currentUserId}
                  onDelete={() => onDelete(r.id)}
                />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
