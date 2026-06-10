import { useQuery, useQueryClient } from '@tanstack/react-query'
import { GitBranch, GitCommit, GitPullRequest, CircleDot, ExternalLink } from 'lucide-react'

import { api } from '../../lib/api'
import type { GithubEvent, Page } from '../../lib/types'
import { timeAgo } from '../../lib/utils'
import { useRealtime } from '../../lib/ws'
import { EmptyState } from '../ui/EmptyState'
import { CenteredSpinner } from '../ui/Spinner'

function eventIcon(event: GithubEvent) {
  if (event.event_type === 'pull_request') return <GitPullRequest size={15} className="text-purple-400" />
  if (event.event_type === 'issues') return <CircleDot size={15} className="text-emerald-400" />
  return <GitCommit size={15} className="text-sky-400" />
}

export function GithubFeed({ projectId }: { projectId: string }) {
  const queryClient = useQueryClient()
  const { data, isLoading } = useQuery({
    queryKey: ['github-events', projectId],
    queryFn: () => api.get<Page<GithubEvent>>(`/github/projects/${projectId}/events?page_size=50`),
  })

  useRealtime(
    'github.event.created',
    (event) => {
      if (event.project_id === projectId) {
        void queryClient.invalidateQueries({ queryKey: ['github-events', projectId] })
      }
    },
    [projectId],
  )

  if (isLoading) return <CenteredSpinner />
  const events = data?.items ?? []

  if (events.length === 0) {
    return (
      <EmptyState
        icon={GitBranch}
        title="No GitHub activity"
        description="Connect a repository to this project to see pushes, pull requests and issues here. Configure the GitHub App webhook to point at /api/v1/github/webhook."
      />
    )
  }

  return (
    <div className="mx-auto max-w-3xl space-y-1 px-6 py-5">
      {events.map((event) => (
        <div key={event.id} className="flex items-start gap-3 rounded-lg px-3 py-2.5 transition-colors hover:bg-ink-850">
          <div className="mt-0.5">{eventIcon(event)}</div>
          <div className="min-w-0 flex-1">
            <p className="text-sm text-fg">
              {(event.payload.summary as string) || `${event.event_type} ${event.action ?? ''}`}
            </p>
            <p className="text-[11px] text-fg-muted">
              {event.payload.repo as string} · {event.actor_login} · {timeAgo(event.created_at)}
            </p>
          </div>
          {event.payload.url ? (
            <a
              href={event.payload.url as string}
              target="_blank"
              rel="noreferrer"
              className="btn-ghost !px-2 !py-1"
            >
              <ExternalLink size={13} />
            </a>
          ) : null}
        </div>
      ))}
    </div>
  )
}
