import { useQuery } from '@tanstack/react-query'
import { useParams } from 'react-router-dom'

import { PublicBreadcrumbBar } from '../../components/navigation/PublicBreadcrumbBar'
import { API_BASE } from '../../lib/env'

interface PublicAssignee {
  display_name?: string
  full_name?: string
  email?: string
}

interface PublicTask {
  title: string
  ref: string
  description: string | null
  task_type: string
  priority: string | null
  due_date: string | null
  status: { name: string; color: string } | null
  assignees: PublicAssignee[]
  checklists?: { id: string; name: string; items: { id: string; content: string; is_done: boolean }[] }[]
}

function assigneeLabel(a: PublicAssignee): string {
  return a.display_name || a.full_name || a.email || 'Team member'
}

async function fetchPublicTask(token: string): Promise<PublicTask> {
  const res = await fetch(`${API_BASE}/public/tasks/${token}`)
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).detail ?? 'Task not available')
  return res.json()
}

export default function PublicTaskPage() {
  const { token } = useParams<{ token: string }>()
  const { data: task, isLoading, isError } = useQuery({
    queryKey: ['public-task', token],
    queryFn: () => fetchPublicTask(token!),
    enabled: !!token,
    retry: false,
  })

  if (isLoading) return <div className="grid min-h-screen place-items-center text-fg-muted">Loading…</div>
  if (isError || !task) {
    return (
      <div className="grid min-h-screen place-items-center px-6 text-center">
        <p className="text-sm text-fg-secondary">This task isn't available. The share link may have been turned off or expired.</p>
      </div>
    )
  }

  const checklists = task.checklists ?? []

  return (
    <div className="min-h-screen bg-ink-950 px-4 py-10">
      <div className="mx-auto max-w-2xl">
        <PublicBreadcrumbBar
          items={[
            { label: 'Shared task' },
            { label: `${task.ref} · ${task.title}`, current: true },
          ]}
        />
      </div>
      <div className="mx-auto max-w-2xl rounded-2xl border border-ink-700 bg-ink-900 p-8">
        <div className="mb-3 flex items-center gap-2 text-xs text-fg-muted">
          <span className="uppercase">{task.task_type}</span>
          {task.ref && <><span>·</span><span>{task.ref}</span></>}
          {task.status && (
            <span className="ml-auto rounded-full px-2 py-0.5 text-[11px] font-medium" style={{ backgroundColor: `${task.status.color}22`, color: task.status.color }}>
              {task.status.name}
            </span>
          )}
        </div>
        <h1 className="text-2xl font-bold text-fg">{task.title}</h1>

        <div className="mt-4 flex flex-wrap gap-x-6 gap-y-2 text-sm text-fg-secondary">
          {task.priority && <span>Priority: <span className="capitalize text-fg">{task.priority}</span></span>}
          {task.due_date && <span>Due: <span className="text-fg">{task.due_date}</span></span>}
          {task.assignees.length > 0 && (
            <span>Assignees: <span className="text-fg">{task.assignees.map(assigneeLabel).join(', ')}</span></span>
          )}
        </div>

        {task.description && (
          <p className="mt-5 whitespace-pre-wrap border-t border-ink-700 pt-5 text-sm leading-relaxed text-fg-secondary">
            {/* Inline-image markup needs an authenticated download; show a readable placeholder instead. */}
            {task.description.replace(
              /!\[([^\]]*)\]\([0-9a-fA-F]{8}(?:-[0-9a-fA-F]{4}){3}-[0-9a-fA-F]{12}\)/g,
              (_, label: string) => `[image: ${label || 'attachment'}]`,
            )}
          </p>
        )}

        {checklists.map((cl) => (
          <div key={cl.id} className="mt-5 border-t border-ink-700 pt-5">
            <p className="mb-2 text-sm font-semibold text-fg">{cl.name}</p>
            <div className="space-y-1">
              {cl.items.map((it) => (
                <div key={it.id} className="flex items-center gap-2 text-sm">
                  <input type="checkbox" checked={it.is_done} readOnly />
                  <span className={it.is_done ? 'text-fg-muted line-through' : 'text-fg-secondary'}>{it.content}</span>
                </div>
              ))}
            </div>
          </div>
        ))}

        <p className="mt-8 text-center text-[11px] text-fg-muted">Shared read-only via FlowDesk</p>
      </div>
    </div>
  )
}
