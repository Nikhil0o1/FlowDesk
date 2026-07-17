import { useState } from 'react'
import { CornerDownRight, MessageSquare, Send } from 'lucide-react'

import { useAuthStore } from '../../../../stores/auth'
import { Avatar } from '../../../../components/ui/Avatar'
import { EmptyState } from '../../../../components/ui/EmptyState'
import { useComments } from '../../hooks/useComments'
import { useMentions } from '../../hooks/useMentions'
import type { DocComment } from '../../types/comment'
import type { FlowDoc } from '../../types/document'
import { DocMentionInput } from '../Mentions/DocMentionInput'
import { CommentThread } from '../CommentThread/CommentThread'

interface CommentsPanelProps {
  doc: FlowDoc
  canComment: boolean
  /** When set, new comments attach to this inline anchor. */
  pendingInline?: { markerId: string; quote: string } | null
  onClearInline?: () => void
}

/** Document comments tab: threads, compose, sort. */
export function CommentsPanel({ doc, canComment, pendingInline, onClearInline }: CommentsPanelProps) {
  const user = useAuthStore((s) => s.user)
  const userId = user?.id ?? 'local-user'
  const { threads, getReplies, addComment, resolveComment, deleteComment, sortedThreads } = useComments(doc.id, doc.title)
  const { candidates, serialize } = useMentions()

  const [body, setBody] = useState('')
  const [mentionMap, setMentionMap] = useState<Map<string, string>>(new Map())
  const [replyTo, setReplyTo] = useState<DocComment | null>(null)
  const [sort, setSort] = useState<'newest' | 'oldest'>('newest')

  const display = sortedThreads(sort)

  const submit = () => {
    const text = body.trim()
    if (!text) return
    addComment(serialize(text, mentionMap), {
      parentId: replyTo?.id ?? null,
      inlineAnchor: pendingInline ? { markerId: pendingInline.markerId, quote: pendingInline.quote } : null,
    })
    setBody('')
    setMentionMap(new Map())
    setReplyTo(null)
    onClearInline?.()
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex items-center justify-between gap-2 border-b border-ink-700 px-4 py-2">
        <span className="text-xs font-semibold text-fg-muted">{display.length} threads</span>
        <select
          aria-label="Sort comments"
          value={sort}
          onChange={(e) => setSort(e.target.value as 'newest' | 'oldest')}
          className="rounded border border-ink-700 bg-ink-800 px-2 py-0.5 text-xs text-fg-secondary"
        >
          <option value="newest">Newest</option>
          <option value="oldest">Oldest</option>
        </select>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
        {display.length === 0 ? (
          <EmptyState icon={MessageSquare} title="No comments" description="Start a discussion on this document." />
        ) : (
          <div className="space-y-3">
            {display.map((thread) => (
              <CommentThread
                key={thread.id}
                thread={thread}
                replies={getReplies(thread.id)}
                canEdit={canComment}
                currentUserId={userId}
                onReply={setReplyTo}
                onResolve={resolveComment}
                onDelete={deleteComment}
              />
            ))}
          </div>
        )}
      </div>

      {canComment && (
        <div className="shrink-0 border-t border-ink-700 bg-ink-900/80 p-4">
          {pendingInline && (
            <div className="mb-2 rounded-lg border border-brand/30 bg-brand-soft/30 px-2 py-1.5 text-xs text-fg-secondary">
              Comment on: “{pendingInline.quote.slice(0, 80)}
              {pendingInline.quote.length > 80 ? '…' : ''}”
              <button type="button" className="ml-2 text-fg-muted hover:text-fg" onClick={onClearInline}>
                cancel
              </button>
            </div>
          )}
          {replyTo && (
            <div className="mb-2 flex items-center gap-2 text-xs text-fg-secondary">
              <CornerDownRight size={12} />
              Replying to <strong>{replyTo.authorName}</strong>
              <button type="button" className="text-fg-muted hover:text-fg" onClick={() => setReplyTo(null)}>
                · cancel
              </button>
            </div>
          )}
          <div className="flex items-start gap-2">
            <Avatar name={user?.profile?.full_name || user?.email || '?'} src={user?.profile?.avatar_url} size={28} />
            <div className="min-w-0 flex-1">
              <DocMentionInput
                candidates={candidates}
                value={body}
                onChange={setBody}
                onMention={(name, id) => setMentionMap((m) => new Map(m).set(name, id))}
                onSubmit={submit}
                compact
              />
              <div className="mt-1.5 flex justify-end">
                <button type="button" className="btn-primary !py-1.5 text-xs" disabled={!body.trim()} onClick={submit}>
                  <Send size={12} /> Comment
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
