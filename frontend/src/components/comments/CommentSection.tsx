import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { CornerDownRight, MessageSquare, Send, Trash2 } from 'lucide-react'
import { useState } from 'react'

import { api, errorMessage } from '../../lib/api'
import type { Comment, Page } from '../../lib/types'
import { renderMentions, timeAgo } from '../../lib/utils'
import { useRealtime } from '../../lib/ws'
import { useAuthStore } from '../../stores/auth'
import { toast } from '../../stores/toast'
import { Avatar } from '../ui/Avatar'
import { CenteredSpinner } from '../ui/Spinner'
import { MentionInput } from './MentionInput'

export function CommentSection({ taskId, projectId }: { taskId: string; projectId: string }) {
  const queryClient = useQueryClient()
  const user = useAuthStore((s) => s.user)
  const [body, setBody] = useState('')
  const [replyTo, setReplyTo] = useState<Comment | null>(null)

  const { data, isLoading } = useQuery({
    queryKey: ['comments', taskId],
    queryFn: () => api.get<Page<Comment>>(`/tasks/${taskId}/comments?page_size=200`),
  })

  useRealtime(
    ['comment.created', 'comment.updated', 'comment.deleted'],
    (event) => {
      if (event.payload.task_id === taskId || event.task_id === taskId) {
        void queryClient.invalidateQueries({ queryKey: ['comments', taskId] })
      }
    },
    [taskId],
  )

  const create = useMutation({
    mutationFn: () =>
      api.post<Comment>(`/tasks/${taskId}/comments`, {
        body: body.trim(),
        parent_comment_id: replyTo?.id ?? null,
      }),
    onSuccess: () => {
      setBody('')
      setReplyTo(null)
      void queryClient.invalidateQueries({ queryKey: ['comments', taskId] })
    },
    onError: (err) => toast.error(errorMessage(err)),
  })

  const remove = async (commentId: string) => {
    try {
      await api.delete(`/comments/${commentId}`)
      void queryClient.invalidateQueries({ queryKey: ['comments', taskId] })
    } catch (err) {
      toast.error(errorMessage(err))
    }
  }

  const comments = data?.items ?? []
  const topLevel = comments.filter((c) => !c.parent_comment_id)
  const repliesByParent = new Map<string, Comment[]>()
  for (const c of comments) {
    if (c.parent_comment_id) {
      const list = repliesByParent.get(c.parent_comment_id) ?? []
      list.push(c)
      repliesByParent.set(c.parent_comment_id, list)
    }
  }

  return (
    <div>
      <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold text-fg">
        <MessageSquare size={15} /> Comments
        <span className="text-xs font-normal text-fg-muted">{comments.length}</span>
      </h3>

      {isLoading ? (
        <CenteredSpinner />
      ) : (
        <div className="space-y-4">
          {topLevel.map((comment) => (
            <CommentItem
              key={comment.id}
              comment={comment}
              replies={repliesByParent.get(comment.id) ?? []}
              onReply={() => setReplyTo(comment)}
              onDelete={remove}
              canDelete={comment.author_id === user?.id}
            />
          ))}
          {topLevel.length === 0 && (
            <p className="py-4 text-sm text-fg-muted">No comments yet. Start the conversation.</p>
          )}
        </div>
      )}

      <div className="mt-4">
        {replyTo && (
          <div className="mb-1.5 flex items-center gap-2 text-xs text-fg-secondary">
            <CornerDownRight size={12} />
            Replying to <strong>{replyTo.author?.full_name || 'comment'}</strong>
            <button className="text-fg-muted hover:text-fg" onClick={() => setReplyTo(null)}>
              · cancel
            </button>
          </div>
        )}
        <div className="flex items-start gap-2.5">
          <Avatar name={user?.profile?.full_name || user?.email || '?'} src={user?.profile?.avatar_url} size={28} />
          <div className="flex-1">
            <MentionInput
              projectId={projectId}
              value={body}
              onChange={setBody}
              onSubmit={() => body.trim() && create.mutate()}
            />
            <div className="mt-1.5 flex justify-end">
              <button
                className="btn-primary !py-1.5 text-xs"
                disabled={!body.trim() || create.isPending}
                onClick={() => create.mutate()}
              >
                <Send size={12} /> Comment
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

function CommentItem({
  comment,
  replies,
  onReply,
  onDelete,
  canDelete,
}: {
  comment: Comment
  replies: Comment[]
  onReply: () => void
  onDelete: (id: string) => void
  canDelete: boolean
}) {
  const user = useAuthStore((s) => s.user)
  return (
    <div className="group">
      <div className="flex items-start gap-2.5">
        <Avatar
          name={comment.author?.full_name || comment.author?.email || '?'}
          src={comment.author?.avatar_url}
          size={28}
          userId={comment.author_id}
          showPresence
        />
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline gap-2">
            <span className="text-sm font-semibold text-fg">
              {comment.author?.full_name || comment.author?.email || 'Unknown'}
            </span>
            <span className="text-[11px] text-fg-muted">{timeAgo(comment.created_at)}</span>
          </div>
          <p className="whitespace-pre-wrap text-sm leading-relaxed text-fg-secondary">
            {renderMentionsJsx(comment.body)}
          </p>
          <div className="mt-1 flex items-center gap-3 opacity-0 transition-opacity group-hover:opacity-100">
            <button className="text-xs text-fg-muted hover:text-fg" onClick={onReply}>
              Reply
            </button>
            {canDelete && (
              <button
                className="flex items-center gap-1 text-xs text-fg-muted hover:text-red-400"
                onClick={() => onDelete(comment.id)}
              >
                <Trash2 size={11} /> Delete
              </button>
            )}
          </div>
        </div>
      </div>
      {replies.length > 0 && (
        <div className="ml-9 mt-2 space-y-3 border-l border-ink-700 pl-4">
          {replies.map((reply) => (
            <CommentItem
              key={reply.id}
              comment={reply}
              replies={[]}
              onReply={onReply}
              onDelete={onDelete}
              canDelete={reply.author_id === user?.id}
            />
          ))}
        </div>
      )}
    </div>
  )
}

/** Highlight @mentions in rendered comments. */
function renderMentionsJsx(body: string): React.ReactNode {
  const parts: React.ReactNode[] = []
  const regex = /@\[([^\]]+)\]\([0-9a-fA-F-]{36}\)/g
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
