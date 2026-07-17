import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Check } from 'lucide-react'
import { useState } from 'react'

import { api, errorMessage } from '../../lib/api'
import type { Comment } from '../../lib/types'
import { invalidateTaskCaches } from '../../lib/taskCache'
import { cn } from '../../lib/utils'
import { toast } from '../../stores/toast'

type Tab = 'write' | 'preview'

export function GithubIssueCommentBox({
  taskId,
  canEdit,
  isCompleted,
  onUpdated,
}: {
  taskId: string
  canEdit: boolean
  isCompleted: boolean
  onUpdated: () => void
}) {
  const queryClient = useQueryClient()
  const [tab, setTab] = useState<Tab>('write')
  const [body, setBody] = useState('')

  const postComment = useMutation({
    mutationFn: () =>
      api.post<Comment>(`/github/tasks/${taskId}/issue-comment`, {
        body: body.trim(),
      }),
    onSuccess: () => {
      toast.success('Comment posted on GitHub')
      setBody('')
      void queryClient.invalidateQueries({ queryKey: ['github-comments', taskId] })
      void queryClient.invalidateQueries({ queryKey: ['task-github-events', taskId] })
      onUpdated()
    },
    onError: (err) => toast.error(errorMessage(err)),
  })

  const closeIssue = useMutation({
    mutationFn: () =>
      api.post<{ updated: boolean; status_id?: string | null }>(
        `/github/tasks/${taskId}/close-issue`,
        body.trim() ? { body: body.trim() } : undefined,
      ),
    onSuccess: (data) => {
      toast.success(data.updated ? 'Issue closed — task completed' : 'Issue closed on GitHub')
      setBody('')
      invalidateTaskCaches(queryClient, taskId)
      void queryClient.invalidateQueries({ queryKey: ['github-comments', taskId] })
      void queryClient.invalidateQueries({ queryKey: ['task-github-events', taskId] })
      onUpdated()
    },
    onError: (err) => toast.error(errorMessage(err)),
  })

  if (!canEdit) return null

  const busy = postComment.isPending || closeIssue.isPending
  const canSubmit = body.trim().length > 0

  const actionBtn =
    'inline-flex cursor-pointer items-center justify-center gap-1.5 rounded-lg px-3.5 py-2 text-xs font-semibold transition-all duration-150 ease-out hover:scale-[1.02] active:scale-[0.98] hover:shadow-md disabled:cursor-not-allowed disabled:scale-100 disabled:opacity-50 disabled:shadow-none'

  return (
    <div className="mt-3 overflow-hidden rounded-xl border border-ink-600 bg-ink-900">
      <div className="border-b border-ink-700 px-3 py-2 text-sm font-semibold text-fg">Add a comment</div>

      <div className="flex border-b border-ink-700 bg-ink-850 px-3">
        {(['write', 'preview'] as Tab[]).map((mode) => (
          <button
            key={mode}
            type="button"
            onClick={() => setTab(mode)}
            className={cn(
              'border-b-2 px-3 py-2 text-xs font-medium capitalize transition-colors',
              tab === mode
                ? 'border-brand text-fg'
                : 'border-transparent text-fg-muted hover:text-fg-secondary',
            )}
          >
            {mode}
          </button>
        ))}
      </div>

      {tab === 'write' ? (
        <textarea
          value={body}
          onChange={(e) => setBody(e.target.value)}
          placeholder="Use Markdown to format your comment"
          rows={5}
          disabled={busy}
          className="w-full resize-y bg-ink-900 px-3 py-2.5 text-sm text-fg outline-none placeholder:text-fg-muted disabled:opacity-60"
        />
      ) : (
        <div className="min-h-[120px] whitespace-pre-wrap px-3 py-2.5 text-sm text-fg-secondary">
          {body.trim() ? body : 'Nothing to preview'}
        </div>
      )}

      <div className="flex flex-wrap items-center justify-end gap-2 border-t border-ink-700 bg-ink-850 px-3 py-2.5">
        {!isCompleted ? (
          <button
            type="button"
            disabled={busy}
            onClick={() => closeIssue.mutate()}
            className={cn(actionBtn, 'btn-secondary !py-1.5 shadow-sm')}
          >
            <Check size={13} className={closeIssue.isPending ? 'animate-pulse' : undefined} />
            {closeIssue.isPending ? 'Closing…' : 'Close issue'}
          </button>
        ) : null}
        <button
          type="button"
          disabled={!canSubmit || busy}
          onClick={() => postComment.mutate()}
          className={cn(
            actionBtn,
            'bg-emerald-600 text-white shadow-sm hover:bg-emerald-500 hover:shadow-emerald-600/30',
            canSubmit && !busy && 'ring-1 ring-emerald-500/40',
          )}
        >
          {postComment.isPending ? 'Posting…' : 'Comment'}
        </button>
      </div>
    </div>
  )
}
