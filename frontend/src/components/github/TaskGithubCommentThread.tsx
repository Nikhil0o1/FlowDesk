import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Github, MessageSquare } from 'lucide-react'
import type { ReactNode } from 'react'

import { api } from '../../lib/api'
import type { Comment, Page } from '../../lib/types'
import { MENTION_MARKUP_RE, renderMentions, timeAgo } from '../../lib/utils'
import { useRealtime } from '../../lib/ws'
import { Avatar } from '../ui/Avatar'
import { CenteredSpinner } from '../ui/Spinner'

export function TaskGithubCommentThread({ taskId }: { taskId: string }) {
  const queryClient = useQueryClient()

  const { data, isLoading } = useQuery({
    queryKey: ['github-comments', taskId],
    queryFn: () => api.get<Page<Comment>>(`/tasks/${taskId}/comments?page_size=200&scope=github`),
  })

  useRealtime(
    ['comment.created', 'comment.updated', 'comment.deleted'],
    (event) => {
      if (event.payload.comment_scope === 'local') return
      if (event.payload.task_id === taskId || event.task_id === taskId) {
        void queryClient.invalidateQueries({ queryKey: ['github-comments', taskId] })
      }
    },
    [taskId],
  )

  const comments = data?.items ?? []
  if (isLoading) {
    return (
      <div className="mb-3 py-2">
        <CenteredSpinner />
      </div>
    )
  }
  if (comments.length === 0) return null

  return (
    <div className="mb-3 overflow-hidden rounded-xl border border-ink-700 bg-ink-900">
      <div className="flex items-center gap-2 border-b border-ink-700 px-3 py-2 text-xs font-semibold text-fg-secondary">
        <MessageSquare size={13} />
        Issue comments
        <span className="font-normal text-fg-muted">({comments.length})</span>
      </div>
      <div className="divide-y divide-ink-700/60">
        {comments.map((comment) => (
          <GithubCommentRow key={comment.id} comment={comment} />
        ))}
      </div>
    </div>
  )
}

function GithubCommentRow({ comment }: { comment: Comment }) {
  const displayName = comment.github_author_login
    ? comment.github_author_login
    : comment.author?.full_name || comment.author?.email || 'Unknown'

  return (
    <div className="flex items-start gap-2.5 px-3 py-2.5">
      <Avatar
        name={displayName}
        src={comment.github_author_login ? undefined : comment.author?.avatar_url}
        size={24}
      />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
          <span className="text-xs font-semibold text-fg">{displayName}</span>
          {comment.github_author_login ? (
            <span className="inline-flex items-center gap-0.5 text-[10px] text-fg-muted">
              <Github size={9} /> GitHub
            </span>
          ) : null}
          <span className="text-[10px] text-fg-muted">{timeAgo(comment.created_at)}</span>
        </div>
        <p className="mt-0.5 whitespace-pre-wrap text-sm leading-relaxed text-fg-secondary">
          {renderCommentBody(comment.body)}
        </p>
      </div>
    </div>
  )
}

function renderCommentBody(body: string): ReactNode {
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
