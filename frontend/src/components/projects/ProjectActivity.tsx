import { useQuery } from '@tanstack/react-query'
import { Activity as ActivityIcon } from 'lucide-react'

import { api } from '../../lib/api'
import type { Activity, Page } from '../../lib/types'
import { timeAgo } from '../../lib/utils'
import { Avatar } from '../ui/Avatar'
import { EmptyState } from '../ui/EmptyState'
import { CenteredSpinner } from '../ui/Spinner'

export const ACTION_LABELS: Record<string, string> = {
  'task.created': 'created task',
  'task.updated': 'updated task',
  'task.status_changed': 'changed status of',
  'task.deleted': 'deleted task',
  'task.assigned': 'assigned',
  'task.unassigned': 'unassigned from',
  'comment.created': 'commented on',
  'sprint.created': 'created sprint',
  'sprint.started': 'started sprint',
  'sprint.completed': 'completed sprint',
  'project.created': 'created project',
  'project.updated': 'updated project',
  'project.member_added': 'added a member to project',
  'list.created': 'created list',
  'attachment.added': 'attached a file to',
  'attachment.removed': 'removed a file from',
  'task.dependency_added': 'added a dependency to',
}

export function ProjectActivity({ projectId }: { projectId: string }) {
  const { data, isLoading } = useQuery({
    queryKey: ['activity', projectId],
    queryFn: () => api.get<Page<Activity>>(`/projects/${projectId}/activity?page_size=80`),
  })

  if (isLoading) return <CenteredSpinner />
  const items = data?.items ?? []
  if (items.length === 0) {
    return <EmptyState icon={ActivityIcon} title="No activity yet" description="Project activity will show up here as your team works." />
  }

  return (
    <div className="mx-auto max-w-3xl space-y-1 px-6 py-5">
      {items.map((entry) => {
        const isGithub = entry.action.startsWith('github.')
        const label = ACTION_LABELS[entry.action] ?? entry.action.replace(/\./g, ' ')
        return (
          <div key={entry.id} className="flex items-start gap-3 rounded-lg px-3 py-2 transition-colors hover:bg-ink-850">
            <Avatar
              name={isGithub ? (entry.data.actor as string) || 'GitHub' : entry.actor?.full_name || '?'}
              src={entry.actor?.avatar_url}
              size={26}
            />
            <div className="min-w-0 flex-1">
              <p className="text-sm text-fg-secondary">
                <span className="font-medium text-fg">
                  {isGithub ? (entry.data.actor as string) || 'GitHub' : entry.actor?.full_name || 'Someone'}
                </span>{' '}
                {isGithub ? (entry.data.summary as string) : (
                  <>
                    {label}{' '}
                    {entry.data.ref ? (
                      <span className="text-fg">
                        {entry.data.ref as string} — {entry.data.title as string}
                      </span>
                    ) : (
                      <span className="text-fg">{(entry.data.name as string) ?? ''}</span>
                    )}
                  </>
                )}
              </p>
              <p className="text-[11px] text-fg-muted">{timeAgo(entry.created_at)}</p>
            </div>
          </div>
        )
      })}
    </div>
  )
}
