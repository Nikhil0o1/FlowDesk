import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  ArrowLeft,
  Calendar,
  CalendarPlus,
  Download,
  GitBranch,
  Link2,
  Paperclip,
  Play,
  Plus,
  Square,
  Tag,
  Timer,
  Trash2,
  X,
} from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'

import { api, errorMessage } from '../../lib/api'
import { useProject, useRunningTimer, useSprints } from '../../lib/queries'
import { recordRecent } from '../../lib/recents'
import type { Page, Sprint, Task, TaskDetail, TimeEntry } from '../../lib/types'
import { cn, formatBytes, formatDate, formatDuration, isOverdue, timeAgo } from '../../lib/utils'
import { useRealtime } from '../../lib/ws'
import { toast } from '../../stores/toast'
import { CommentSection } from '../../components/comments/CommentSection'
import { AssigneePicker, DatePicker, PriorityPicker, StatusPicker } from '../../components/tasks/pickers'
import { Dropdown } from '../../components/ui/Dropdown'
import { AvatarStack } from '../../components/ui/Avatar'
import { LabelChip, PriorityFlag, StatusPill, TaskTypeBadge } from '../../components/ui/badges'
import { CenteredSpinner } from '../../components/ui/Spinner'

export default function TaskPage() {
  const { taskId } = useParams<{ taskId: string }>()
  const navigate = useNavigate()
  const queryClient = useQueryClient()

  const { data: task, isLoading, isError, error } = useQuery({
    queryKey: ['task', taskId],
    queryFn: () => api.get<TaskDetail>(`/tasks/${taskId}`),
    enabled: !!taskId,
  })

  useRealtime(
    ['task.updated', 'task.assigned', 'task.deleted'],
    (event) => {
      if (event.task_id === taskId) {
        void queryClient.invalidateQueries({ queryKey: ['task', taskId] })
      }
    },
    [taskId],
  )

  useEffect(() => {
    if (task) recordRecent({ type: 'task', id: task.id, label: task.title, sublabel: task.ref })
  }, [task?.id, task?.title])

  const update = useMutation({
    mutationFn: (body: Record<string, unknown>) => api.patch<Task>(`/tasks/${taskId}`, body),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['task', taskId] })
      void queryClient.invalidateQueries({ queryKey: ['tasks'] })
    },
    onError: (err) => toast.error(errorMessage(err)),
  })

  if (isLoading) return <CenteredSpinner />
  if (isError || !task) {
    return (
      <div className="p-10 text-center">
        <p className="text-sm text-fg-secondary">{isError ? errorMessage(error) : 'Task not found'}</p>
        <button className="btn-secondary mt-4" onClick={() => navigate(-1)}>
          Go back
        </button>
      </div>
    )
  }

  return (
    <div className="mx-auto max-w-5xl px-6 py-5">
      {/* Header */}
      <div className="mb-4 flex items-center gap-2 text-sm text-fg-muted">
        <button onClick={() => navigate(-1)} className="btn-ghost !px-2">
          <ArrowLeft size={16} />
        </button>
        <TaskTypeBadge type={task.task_type} withLabel />
        <span>·</span>
        <span className="font-medium text-fg-secondary">{task.ref}</span>
        <span className="flex-1" />
        <DeleteTaskButton taskId={task.id} onDeleted={() => navigate(-1)} />
      </div>

      <div className="grid grid-cols-[1fr_280px] gap-8 max-lg:grid-cols-1">
        {/* Main column */}
        <div className="min-w-0">
          <EditableTitle
            value={task.title}
            completed={!!task.completed_at}
            onSave={(title) => update.mutate({ title })}
          />

          <EditableDescription
            value={task.description ?? ''}
            onSave={(description) => update.mutate({ description })}
          />

          <Subtasks task={task} />
          <Dependencies task={task} />
          <Attachments task={task} />
          <TimeTracking task={task} />
          <TaskGithub task={task} onTaskUpdate={() => void queryClient.invalidateQueries({ queryKey: ['task', taskId] })} />
          <TaskEmails task={task} />

          <div className="mt-8 border-t border-ink-700 pt-6">
            <CommentSection taskId={task.id} projectId={task.project_id} />
          </div>
        </div>

        {/* Meta sidebar */}
        <aside className="space-y-4 max-lg:order-first">
          <MetaRow label="Status">
            <StatusPicker
              projectId={task.project_id}
              value={task.status}
              onChange={(statusId) => update.mutate({ status_id: statusId })}
            >
              <span className="cursor-pointer">
                <StatusPill status={task.status} size="md" />
              </span>
            </StatusPicker>
          </MetaRow>

          <MetaRow label="Assignees">
            <AssigneePicker task={task}>
              <span className="flex cursor-pointer items-center gap-1.5">
                {task.assignees.length > 0 ? (
                  <AvatarStack users={task.assignees} size={26} />
                ) : (
                  <span className="text-sm text-fg-muted hover:text-fg-secondary">+ Assign</span>
                )}
              </span>
            </AssigneePicker>
          </MetaRow>

          <MetaRow label="Priority">
            <PriorityPicker
              value={task.priority}
              onChange={(p) => update.mutate(p ? { priority: p } : { clear_priority: true })}
            >
              <span className="flex cursor-pointer items-center gap-1.5 text-sm text-fg-secondary">
                <PriorityFlag priority={task.priority} withLabel />
                {!task.priority && 'Set priority'}
              </span>
            </PriorityPicker>
          </MetaRow>

          <MetaRow label="Due date">
            <div className="flex items-center gap-2">
              <DatePicker
                value={task.due_date}
                onChange={(d) => update.mutate(d ? { due_date: d } : { clear_due_date: true })}
              >
                <span
                  className={cn(
                    'flex cursor-pointer items-center gap-1.5 text-sm',
                    isOverdue(task.due_date, task.completed_at)
                      ? 'font-medium text-red-400'
                      : 'text-fg-secondary',
                  )}
                >
                  <Calendar size={14} />
                  {task.due_date ? formatDate(task.due_date) : 'Set due date'}
                </span>
              </DatePicker>
              {task.due_date && <AddToCalendarButton taskId={task.id} />}
            </div>
          </MetaRow>

          <MetaRow label="Story points">
            <PointsEditor value={task.story_points} onSave={(p) => update.mutate({ story_points: p })} />
          </MetaRow>

          <MetaRow label="Sprint">
            <SprintRow task={task} />
          </MetaRow>

          <MetaRow label="Labels">
            <LabelsEditor
              labels={task.labels}
              onSave={(labels) => update.mutate({ labels })}
            />
          </MetaRow>

          <MetaRow label="Tracked time">
            <span className="flex items-center gap-1.5 text-sm text-fg-secondary">
              <Timer size={14} />
              {task.total_tracked_seconds > 0 ? formatDuration(task.total_tracked_seconds) : '—'}
            </span>
          </MetaRow>
        </aside>
      </div>
    </div>
  )
}

/** Push the task's due date onto the user's Google Calendar as an all-day event. */
function AddToCalendarButton({ taskId }: { taskId: string }) {
  const [busy, setBusy] = useState(false)
  const add = async () => {
    setBusy(true)
    try {
      const { link } = await api.post<{ link: string }>(`/tasks/${taskId}/calendar-event`)
      toast.success('Added to your Google Calendar')
      if (link) window.open(link, '_blank', 'noreferrer')
    } catch (err) {
      toast.error(errorMessage(err))
    } finally {
      setBusy(false)
    }
  }
  return (
    <button
      className="text-fg-muted transition-colors hover:text-brand"
      title="Add to Google Calendar"
      disabled={busy}
      onClick={() => void add()}
    >
      <CalendarPlus size={14} />
    </button>
  )
}

interface RepoOut {
  id: string
  repo_full_name: string
  default_branch: string
  is_active: boolean
}

interface TaskGithubEvent {
  id: string
  event_type: string
  action: string | null
  actor_login: string | null
  payload: Record<string, unknown>
  created_at: string
}

function branchNameFor(task: TaskDetail): string {
  const slug = task.title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
  return `${task.ref.toLowerCase()}${slug ? `-${slug}` : ''}`
}

/** ClickUp-style development panel: linked GitHub activity + branch/issue/PR actions. */
function TaskGithub({ task, onTaskUpdate }: { task: TaskDetail; onTaskUpdate: () => void }) {
  const queryClient = useQueryClient()
  const repos = useQuery({
    queryKey: ['project-repos', task.project_id],
    queryFn: () => api.get<RepoOut[]>(`/github/projects/${task.project_id}/repositories`),
  })
  const events = useQuery({
    queryKey: ['task-github-events', task.id],
    queryFn: () => api.get<TaskGithubEvent[]>(`/github/tasks/${task.id}/events`),
  })

  const createIssue = useMutation({
    mutationFn: () => api.post<{ issue_number: number; issue_url: string }>(`/github/tasks/${task.id}/create-issue`),
    onSuccess: () => {
      onTaskUpdate()
      void queryClient.invalidateQueries({ queryKey: ['task', task.id] })
    },
    onError: (err) => toast.error(errorMessage(err)),
  })

  const repo = (repos.data ?? []).find((r) => r.is_active)
  const hasEvents = (events.data ?? []).length > 0
  if (!repo && !hasEvents) return null

  const branch = branchNameFor(task)
  const copyBranch = async () => {
    await navigator.clipboard.writeText(branch)
    toast.success(`Branch name copied: ${branch}`)
  }

  return (
    <div className="mt-8">
      <h3 className="mb-2 flex items-center gap-2 text-sm font-semibold text-fg">
        <GitBranch size={14} className="text-fg-secondary" /> Development
      </h3>

      {repo && (
        <div className="mb-2 flex flex-wrap items-center gap-2">
          <button className="btn-secondary !py-1 text-xs" onClick={() => void copyBranch()} title={branch}>
            Copy branch name
          </button>

          {task.github_issue_number ? (
            <a
              className="btn-secondary !py-1 text-xs flex items-center gap-1"
              href={task.github_issue_url ?? `https://github.com/${repo.repo_full_name}/issues/${task.github_issue_number}`}
              target="_blank"
              rel="noreferrer"
            >
              Issue #{task.github_issue_number}
            </a>
          ) : (
            <button
              className="btn-secondary !py-1 text-xs"
              disabled={createIssue.isPending}
              onClick={() => createIssue.mutate()}
            >
              {createIssue.isPending ? 'Creating…' : 'Create GitHub Issue'}
            </button>
          )}

          <a
            className="btn-secondary !py-1 text-xs"
            href={`https://github.com/${repo.repo_full_name}/compare`}
            target="_blank"
            rel="noreferrer"
          >
            New pull request
          </a>
        </div>
      )}

      {hasEvents ? (
        <div className="overflow-hidden rounded-xl border border-ink-700">
          {(events.data ?? []).map((event) => (
            <a
              key={event.id}
              href={(event.payload.url as string) || undefined}
              target="_blank"
              rel="noreferrer"
              className="flex items-center gap-3 border-b border-ink-700/60 bg-ink-900 px-4 py-2 last:border-b-0 hover:bg-ink-850"
            >
              <span className="min-w-0 flex-1 truncate text-sm text-fg">
                {(event.payload.summary as string) || `${event.event_type} ${event.action ?? ''}`}
              </span>
              <span className="shrink-0 text-[11px] text-fg-muted">
                {event.actor_login} · {timeAgo(event.created_at)}
              </span>
            </a>
          ))}
        </div>
      ) : (
        repo && (
          <p className="text-xs text-fg-muted">
            No GitHub activity yet — mention {task.ref} in a commit, PR or issue on {repo.repo_full_name}.
          </p>
        )
      )}
    </div>
  )
}

interface TaskEmailsOut {
  connected: boolean
  emails: { id: string; subject: string; sender: string; date: string; snippet: string; link: string }[]
}

/** The caller's own Gmail messages mentioning this task's ref (read-only). */
function TaskEmails({ task }: { task: TaskDetail }) {
  const navigate = useNavigate()
  const { data } = useQuery({
    queryKey: ['task-emails', task.id],
    queryFn: () => api.get<TaskEmailsOut>(`/tasks/${task.id}/emails`),
    staleTime: 60_000,
  })

  if (!data) return null

  return (
    <div className="mt-8">
      <h3 className="mb-2 flex items-center gap-2 text-sm font-semibold text-fg">
        Emails
        {data.connected && <span className="text-xs font-normal text-fg-muted">mentioning {task.ref} in your Gmail</span>}
      </h3>
      {!data.connected ? (
        <p className="text-xs text-fg-muted">
          <button className="text-brand hover:underline" onClick={() => navigate('/app/apps')}>
            Connect your Google account
          </button>{' '}
          to see emails that mention this task.
        </p>
      ) : data.emails.length === 0 ? (
        <p className="text-xs text-fg-muted">No emails mention {task.ref}.</p>
      ) : (
        <div className="overflow-hidden rounded-xl border border-ink-700">
          {data.emails.map((mail) => (
            <a
              key={mail.id}
              href={mail.link}
              target="_blank"
              rel="noreferrer"
              className="block border-b border-ink-700/60 bg-ink-900 px-4 py-2.5 last:border-b-0 hover:bg-ink-850"
            >
              <div className="flex items-baseline gap-2">
                <span className="min-w-0 flex-1 truncate text-sm font-medium text-fg">{mail.subject}</span>
                <span className="shrink-0 text-[11px] text-fg-muted">{mail.date.slice(0, 22)}</span>
              </div>
              <p className="mt-0.5 truncate text-xs text-fg-secondary">
                {mail.sender} — {mail.snippet}
              </p>
            </a>
          ))}
        </div>
      )}
    </div>
  )
}

const SPRINT_STATUS_STYLES: Record<Sprint['status'], string> = {
  planned: 'bg-ink-750 text-fg-secondary',
  active: 'bg-emerald-500/15 text-emerald-400',
  completed: 'bg-brand-soft text-brand',
}

/** Show the sprints this task is in; add to / remove from open sprints (ClickUp-style). */
function SprintRow({ task }: { task: TaskDetail }) {
  const queryClient = useQueryClient()
  const project = useProject(task.project_id)
  const taskSprints = useQuery({
    queryKey: ['task-sprints', task.id],
    queryFn: () => api.get<Sprint[]>(`/tasks/${task.id}/sprints`),
  })
  const allSprints = useSprints(project.data?.workspace_id)

  const inIds = new Set((taskSprints.data ?? []).map((s) => s.id))
  const addable = (allSprints.data ?? []).filter(
    (s) => s.status !== 'completed' && !inIds.has(s.id) && (!s.project_id || s.project_id === task.project_id),
  )

  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: ['task-sprints', task.id] })
    void queryClient.invalidateQueries({ queryKey: ['sprints'] })
    void queryClient.invalidateQueries({ queryKey: ['sprint-tasks'] })
  }

  const add = async (sprintId: string) => {
    try {
      await api.post(`/sprints/${sprintId}/tasks`, { task_ids: [task.id] })
      refresh()
    } catch (err) {
      toast.error(errorMessage(err))
    }
  }

  const remove = async (sprintId: string) => {
    try {
      await api.delete(`/sprints/${sprintId}/tasks/${task.id}`)
      refresh()
    } catch (err) {
      toast.error(errorMessage(err))
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {(taskSprints.data ?? []).map((sprint) => (
        <span
          key={sprint.id}
          className={cn(
            'group flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] font-medium',
            SPRINT_STATUS_STYLES[sprint.status],
          )}
        >
          {sprint.name}
          {sprint.status !== 'completed' && (
            <button
              className="hidden text-current opacity-70 hover:opacity-100 group-hover:inline"
              onClick={() => void remove(sprint.id)}
              title="Remove from sprint"
            >
              <X size={11} />
            </button>
          )}
        </span>
      ))}
      {addable.length > 0 && (
        <Dropdown
          width="w-52"
          trigger={
            <button className="text-sm text-fg-muted hover:text-fg-secondary">
              {(taskSprints.data ?? []).length === 0 ? '+ Add to sprint' : '+'}
            </button>
          }
        >
          {(close) =>
            addable.map((sprint) => (
              <button
                key={sprint.id}
                className="menu-item"
                onClick={() => {
                  void add(sprint.id)
                  close()
                }}
              >
                <span className="flex-1 truncate">{sprint.name}</span>
                <span className={cn('rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase', SPRINT_STATUS_STYLES[sprint.status])}>
                  {sprint.status}
                </span>
              </button>
            ))
          }
        </Dropdown>
      )}
      {(taskSprints.data ?? []).length === 0 && addable.length === 0 && (
        <span className="text-sm text-fg-muted">—</span>
      )}
    </div>
  )
}

function MetaRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-3">
      <span className="w-24 shrink-0 text-xs font-medium text-fg-muted">{label}</span>
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  )
}

function EditableTitle({
  value,
  completed,
  onSave,
}: {
  value: string
  completed: boolean
  onSave: (title: string) => void
}) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(value)
  useEffect(() => setDraft(value), [value])

  if (editing) {
    return (
      <input
        autoFocus
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => {
          setEditing(false)
          if (draft.trim() && draft !== value) onSave(draft.trim())
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
          if (e.key === 'Escape') {
            setDraft(value)
            setEditing(false)
          }
        }}
        className="w-full bg-transparent text-2xl font-bold text-fg outline-none"
      />
    )
  }
  return (
    <h1
      onClick={() => setEditing(true)}
      className={cn(
        'cursor-text text-2xl font-bold leading-tight',
        completed ? 'text-fg-muted line-through' : 'text-fg',
      )}
    >
      {value}
    </h1>
  )
}

function EditableDescription({ value, onSave }: { value: string; onSave: (d: string) => void }) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(value)
  useEffect(() => setDraft(value), [value])

  if (editing) {
    return (
      <div className="mt-4">
        <textarea
          autoFocus
          rows={6}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          className="input-dark resize-y"
          placeholder="Add a description…"
        />
        <div className="mt-2 flex gap-2">
          <button
            className="btn-primary !py-1.5 text-xs"
            onClick={() => {
              onSave(draft)
              setEditing(false)
            }}
          >
            Save
          </button>
          <button
            className="btn-ghost text-xs"
            onClick={() => {
              setDraft(value)
              setEditing(false)
            }}
          >
            Cancel
          </button>
        </div>
      </div>
    )
  }
  return (
    <div
      onClick={() => setEditing(true)}
      className="mt-4 min-h-[60px] cursor-text rounded-lg border border-transparent px-3 py-2 -mx-3 transition-colors hover:border-ink-700 hover:bg-ink-850/50"
    >
      {value ? (
        <p className="whitespace-pre-wrap text-sm leading-relaxed text-fg-secondary">{value}</p>
      ) : (
        <p className="text-sm text-fg-muted">Add a description…</p>
      )}
    </div>
  )
}

function PointsEditor({ value, onSave }: { value: number | null; onSave: (p: number) => void }) {
  const [draft, setDraft] = useState(value?.toString() ?? '')
  useEffect(() => setDraft(value?.toString() ?? ''), [value])
  return (
    <input
      value={draft}
      onChange={(e) => setDraft(e.target.value.replace(/\D/g, ''))}
      onBlur={() => {
        const n = parseInt(draft, 10)
        if (!Number.isNaN(n) && n !== value) onSave(n)
      }}
      onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
      placeholder="—"
      className="w-16 rounded-lg border border-transparent bg-transparent px-2 py-1 text-sm text-fg-secondary outline-none transition-colors hover:border-ink-700 focus:border-brand focus:bg-ink-800"
    />
  )
}

function LabelsEditor({ labels, onSave }: { labels: string[]; onSave: (labels: string[]) => void }) {
  const [adding, setAdding] = useState(false)
  const [draft, setDraft] = useState('')
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {labels.map((label) => (
        <span key={label} className="group/chip inline-flex items-center">
          <LabelChip label={label} />
          <button
            className="-ml-1 hidden rounded-full bg-ink-700 p-0.5 text-fg-muted group-hover/chip:block"
            onClick={() => onSave(labels.filter((l) => l !== label))}
          >
            <X size={9} />
          </button>
        </span>
      ))}
      {adding ? (
        <input
          autoFocus
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={() => {
            if (draft.trim()) onSave([...labels, draft.trim()])
            setDraft('')
            setAdding(false)
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
            if (e.key === 'Escape') {
              setDraft('')
              setAdding(false)
            }
          }}
          className="w-20 rounded border border-ink-600 bg-ink-800 px-1.5 py-0.5 text-[11px] text-fg outline-none"
        />
      ) : (
        <button
          onClick={() => setAdding(true)}
          className="flex items-center gap-0.5 text-[11px] text-fg-muted hover:text-fg-secondary"
        >
          <Tag size={11} /> Add
        </button>
      )}
    </div>
  )
}

function Subtasks({ task }: { task: TaskDetail }) {
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  const [adding, setAdding] = useState(false)
  const [title, setTitle] = useState('')

  const create = async () => {
    if (!title.trim()) return
    try {
      await api.post(`/projects/${task.project_id}/tasks`, {
        title: title.trim(),
        parent_task_id: task.id,
      })
      setTitle('')
      void queryClient.invalidateQueries({ queryKey: ['task', task.id] })
    } catch (err) {
      toast.error(errorMessage(err))
    }
  }

  if (task.parent_task_id) return null

  return (
    <section className="mt-7">
      <h3 className="mb-2 flex items-center gap-2 text-sm font-semibold text-fg">
        <GitBranch size={15} /> Subtasks
        <span className="text-xs font-normal text-fg-muted">
          {task.subtasks.filter((s) => s.completed_at).length}/{task.subtasks.length}
        </span>
      </h3>
      <div className="overflow-hidden rounded-xl border border-ink-700">
        {task.subtasks.map((subtask) => (
          <button
            key={subtask.id}
            onClick={() => navigate(`/app/tasks/${subtask.id}`)}
            className="flex w-full items-center gap-2.5 border-b border-ink-700/60 bg-ink-900 px-3.5 py-2 text-left transition-colors last:border-b-0 hover:bg-ink-850"
          >
            <span className="text-xs text-fg-muted">{subtask.ref}</span>
            <span
              className={cn(
                'flex-1 truncate text-sm',
                subtask.completed_at ? 'text-fg-muted line-through' : 'text-fg',
              )}
            >
              {subtask.title}
            </span>
            <AvatarStack users={subtask.assignees} size={20} />
            <StatusPill status={subtask.status} />
          </button>
        ))}
        {adding ? (
          <div className="flex items-center gap-2 bg-ink-850 px-3.5 py-2">
            <input
              autoFocus
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') void create()
                if (e.key === 'Escape') setAdding(false)
              }}
              onBlur={() => !title.trim() && setAdding(false)}
              placeholder="Subtask name…"
              className="flex-1 bg-transparent text-sm text-fg outline-none placeholder:text-fg-muted"
            />
          </div>
        ) : (
          <button
            onClick={() => setAdding(true)}
            className="flex w-full items-center gap-2 px-3.5 py-2 text-sm text-fg-muted transition-colors hover:bg-ink-850 hover:text-fg-secondary"
          >
            <Plus size={14} /> Add subtask
          </button>
        )}
      </div>
    </section>
  )
}

function Dependencies({ task }: { task: TaskDetail }) {
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  const [adding, setAdding] = useState(false)
  const [query, setQuery] = useState('')

  const search = useQuery({
    queryKey: ['dep-search', task.project_id, query],
    queryFn: () =>
      api.get<Page<Task>>(`/projects/${task.project_id}/tasks?q=${encodeURIComponent(query)}&page_size=8`),
    enabled: adding && query.trim().length >= 2,
  })

  const addDep = async (dependsOnId: string) => {
    try {
      await api.post(`/tasks/${task.id}/dependencies`, { depends_on_task_id: dependsOnId })
      setAdding(false)
      setQuery('')
      void queryClient.invalidateQueries({ queryKey: ['task', task.id] })
    } catch (err) {
      toast.error(errorMessage(err))
    }
  }

  const removeDep = async (depId: string) => {
    try {
      await api.delete(`/tasks/${task.id}/dependencies/${depId}`)
      void queryClient.invalidateQueries({ queryKey: ['task', task.id] })
    } catch (err) {
      toast.error(errorMessage(err))
    }
  }

  if (task.dependencies.length === 0 && task.dependents.length === 0 && !adding) {
    return (
      <button
        onClick={() => setAdding(true)}
        className="mt-4 flex items-center gap-1.5 text-xs text-fg-muted hover:text-fg-secondary"
      >
        <Link2 size={12} /> Add dependency
      </button>
    )
  }

  return (
    <section className="mt-7">
      <h3 className="mb-2 flex items-center gap-2 text-sm font-semibold text-fg">
        <Link2 size={15} /> Dependencies
      </h3>
      <div className="space-y-1.5">
        {task.dependencies.map((dep) => (
          <div
            key={dep.id}
            className="group flex items-center gap-2 rounded-lg border border-ink-700 bg-ink-900 px-3 py-1.5"
          >
            <span className="text-[11px] font-medium uppercase text-amber-400">Waiting on</span>
            {dep.depends_on && (
              <button
                className="flex min-w-0 flex-1 items-center gap-2 text-left"
                onClick={() => navigate(`/app/tasks/${dep.depends_on_task_id}`)}
              >
                <span className="text-xs text-fg-muted">{dep.depends_on.ref}</span>
                <span className="truncate text-sm text-fg">{dep.depends_on.title}</span>
                <StatusPill status={dep.depends_on.status} />
              </button>
            )}
            <button
              className="hidden text-fg-muted hover:text-red-400 group-hover:block"
              onClick={() => removeDep(dep.id)}
            >
              <X size={13} />
            </button>
          </div>
        ))}
        {task.dependents.map((dep) => (
          <div key={dep.id} className="flex items-center gap-2 rounded-lg border border-ink-700 bg-ink-900 px-3 py-1.5">
            <span className="text-[11px] font-medium uppercase text-sky-400">Blocks</span>
            {dep.depends_on && (
              <button
                className="flex min-w-0 flex-1 items-center gap-2 text-left"
                onClick={() => navigate(`/app/tasks/${dep.task_id}`)}
              >
                <span className="text-xs text-fg-muted">{dep.depends_on.ref}</span>
                <span className="truncate text-sm text-fg">{dep.depends_on.title}</span>
                <StatusPill status={dep.depends_on.status} />
              </button>
            )}
          </div>
        ))}
        {adding ? (
          <div className="rounded-lg border border-ink-600 bg-ink-850 p-2">
            <input
              autoFocus
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => e.key === 'Escape' && setAdding(false)}
              placeholder="Search tasks this depends on…"
              className="input-dark"
            />
            {(search.data?.items ?? [])
              .filter((t) => t.id !== task.id)
              .map((t) => (
                <button key={t.id} className="menu-item mt-1" onClick={() => addDep(t.id)}>
                  <span className="text-xs text-fg-muted">{t.ref}</span>
                  <span className="flex-1 truncate">{t.title}</span>
                </button>
              ))}
          </div>
        ) : (
          <button
            onClick={() => setAdding(true)}
            className="flex items-center gap-1.5 px-1 text-xs text-fg-muted hover:text-fg-secondary"
          >
            <Plus size={12} /> Add dependency
          </button>
        )}
      </div>
    </section>
  )
}

function Attachments({ task }: { task: TaskDetail }) {
  const queryClient = useQueryClient()
  const fileRef = useRef<HTMLInputElement>(null)
  const [uploading, setUploading] = useState(false)

  const upload = async (file: File) => {
    setUploading(true)
    try {
      const form = new FormData()
      form.append('file', file)
      await api.upload(`/tasks/${task.id}/attachments`, form)
      toast.success('Attachment uploaded')
      void queryClient.invalidateQueries({ queryKey: ['task', task.id] })
    } catch (err) {
      toast.error(errorMessage(err))
    } finally {
      setUploading(false)
    }
  }

  const download = async (attachmentId: string, fileName: string) => {
    try {
      const blob = await api.get<Blob>(`/attachments/${attachmentId}/download`)
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = fileName
      a.click()
      URL.revokeObjectURL(url)
    } catch (err) {
      toast.error(errorMessage(err))
    }
  }

  const remove = async (attachmentId: string) => {
    try {
      await api.delete(`/attachments/${attachmentId}`)
      void queryClient.invalidateQueries({ queryKey: ['task', task.id] })
    } catch (err) {
      toast.error(errorMessage(err))
    }
  }

  return (
    <section className="mt-7">
      <h3 className="mb-2 flex items-center gap-2 text-sm font-semibold text-fg">
        <Paperclip size={15} /> Attachments
        <span className="text-xs font-normal text-fg-muted">{task.attachments.length}</span>
        <span className="flex-1" />
        <button
          className="btn-ghost !py-1 text-xs"
          disabled={uploading}
          onClick={() => fileRef.current?.click()}
        >
          <Plus size={13} /> {uploading ? 'Uploading…' : 'Upload'}
        </button>
        <input
          ref={fileRef}
          type="file"
          hidden
          onChange={(e) => {
            const file = e.target.files?.[0]
            if (file) void upload(file)
            e.target.value = ''
          }}
        />
      </h3>
      {task.attachments.length > 0 && (
        <div className="space-y-1.5">
          {task.attachments.map((attachment) => (
            <div
              key={attachment.id}
              className="group flex items-center gap-3 rounded-lg border border-ink-700 bg-ink-900 px-3 py-2"
            >
              <Paperclip size={14} className="shrink-0 text-fg-muted" />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm text-fg">{attachment.file_name}</p>
                <p className="text-[11px] text-fg-muted">
                  {formatBytes(attachment.size_bytes)} ·{' '}
                  {attachment.uploader?.full_name || 'unknown'} · {formatDate(attachment.created_at)}
                </p>
              </div>
              <button
                className="btn-ghost !px-2 !py-1"
                onClick={() => download(attachment.id, attachment.file_name)}
              >
                <Download size={14} />
              </button>
              <button
                className="hidden text-fg-muted hover:text-red-400 group-hover:block"
                onClick={() => remove(attachment.id)}
              >
                <Trash2 size={14} />
              </button>
            </div>
          ))}
        </div>
      )}
    </section>
  )
}

function TimeTracking({ task }: { task: TaskDetail }) {
  const queryClient = useQueryClient()
  const runningTimer = useRunningTimer()
  const entries = useQuery({
    queryKey: ['time-entries', task.id],
    queryFn: () => api.get<Page<TimeEntry>>(`/tasks/${task.id}/time-entries?page_size=20`),
  })

  const running = runningTimer.data
  const runningHere = running?.task_id === task.id

  const start = async () => {
    try {
      await api.post(`/tasks/${task.id}/timer/start`, {})
      void queryClient.invalidateQueries({ queryKey: ['timer'] })
      void queryClient.invalidateQueries({ queryKey: ['time-entries', task.id] })
    } catch (err) {
      toast.error(errorMessage(err))
    }
  }

  const stop = async () => {
    try {
      await api.post('/timer/stop')
      void queryClient.invalidateQueries({ queryKey: ['timer'] })
      void queryClient.invalidateQueries({ queryKey: ['time-entries', task.id] })
      void queryClient.invalidateQueries({ queryKey: ['task', task.id] })
    } catch (err) {
      toast.error(errorMessage(err))
    }
  }

  return (
    <section className="mt-7">
      <h3 className="mb-2 flex items-center gap-2 text-sm font-semibold text-fg">
        <Timer size={15} /> Time tracking
        <span className="flex-1" />
        {runningHere ? (
          <button className="btn-secondary !border-red-500/40 !py-1 text-xs !text-red-400" onClick={stop}>
            <Square size={11} fill="currentColor" /> Stop timer
          </button>
        ) : (
          <button className="btn-ghost !py-1 text-xs" disabled={!!running} onClick={start} title={running ? 'Stop your other timer first' : undefined}>
            <Play size={12} /> Start timer
          </button>
        )}
      </h3>
      {(entries.data?.items ?? []).length > 0 && (
        <div className="space-y-1">
          {entries.data!.items.map((entry) => (
            <div key={entry.id} className="flex items-center gap-3 rounded-lg px-3 py-1.5 text-sm hover:bg-ink-850">
              <span className="text-fg-secondary">{entry.user?.full_name || 'Someone'}</span>
              <span className="flex-1 truncate text-xs text-fg-muted">
                {entry.is_manual ? 'manual entry' : entry.stopped_by_system ? 'auto-stopped' : 'timer'}
                {entry.description ? ` · ${entry.description}` : ''}
              </span>
              <span className="text-xs text-fg-muted">{formatDate(entry.started_at)}</span>
              <span className="w-16 text-right font-mono text-xs text-fg">
                {entry.duration_seconds != null ? formatDuration(entry.duration_seconds) : 'running'}
              </span>
            </div>
          ))}
        </div>
      )}
    </section>
  )
}

function DeleteTaskButton({ taskId, onDeleted }: { taskId: string; onDeleted: () => void }) {
  const queryClient = useQueryClient()
  const [confirming, setConfirming] = useState(false)

  const remove = async () => {
    try {
      await api.delete(`/tasks/${taskId}`)
      toast.success('Task deleted')
      void queryClient.invalidateQueries({ queryKey: ['tasks'] })
      onDeleted()
    } catch (err) {
      toast.error(errorMessage(err))
    }
  }

  if (confirming) {
    return (
      <span className="flex items-center gap-2 text-xs">
        <span className="text-fg-secondary">Delete this task?</span>
        <button className="font-semibold text-red-400 hover:text-red-300" onClick={remove}>
          Delete
        </button>
        <button className="text-fg-muted hover:text-fg" onClick={() => setConfirming(false)}>
          Cancel
        </button>
      </span>
    )
  }
  return (
    <button className="btn-ghost !px-2 text-fg-muted hover:!text-red-400" onClick={() => setConfirming(true)} title="Delete task">
      <Trash2 size={15} />
    </button>
  )
}
