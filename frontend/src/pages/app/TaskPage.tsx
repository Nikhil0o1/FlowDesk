import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  ArrowLeft,
  Calendar,
  CalendarPlus,
  Clock,
  Download,
  Eye,
  Flag,
  GitBranch,
  Link2,
  Loader2,
  Lock,
  Paperclip,
  Play,
  Plus,
  Share2,
  Square,
  Tag,
  Timer,
  Trash2,
  UserPlus,
  X,
} from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'

import { ApiError, api, errorMessage } from '../../lib/api'
import { canEditProjectTasks } from '../../lib/projectAccess'
import { EXTERNAL_LINK_REL, openExternalUrl, safeGithubUrl, safeHttpUrl } from '../../lib/safeUrl'
import { useCurrentContext, useProject, useRunningTimer, useSprints } from '../../lib/queries'
import { recordRecent } from '../../lib/recents'
import { favoriteTaskTarget } from '../../lib/favorites'
import { cleanupDeletedTask } from '../../lib/taskDeletion'
import { invalidateTaskCaches } from '../../lib/taskCache'
import { useTaskPatch, withDueDate, withPriority, withStatus } from '../../lib/taskMutations'
import { buildStatusUpdate } from '../../lib/taskStatusChange'
import type { Attachment, Page, Sprint, Task, TaskDetail, TimeEntry } from '../../lib/types'
import { cn, formatBytes, formatDate, formatDuration, combineDurationParts, splitDurationParts, isOverdue, timeAgo } from '../../lib/utils'
import { useRealtime } from '../../lib/ws'
import { toast } from '../../stores/toast'
import { CommentSection } from '../../components/comments/CommentSection'
import { FavoriteButton } from '../../components/favorites/FavoriteButton'
import { GitHubIcon } from '../../components/icons/brands'
import { SubtaskIcon } from '../../components/icons/subtask'
import { GithubIssueCommentBox } from '../../components/github/GithubIssueCommentBox'
import { TaskGithubCommentThread } from '../../components/github/TaskGithubCommentThread'
import { Checklists } from '../../components/tasks/Checklists'
import { ShareModal } from '../../components/tasks/ShareModal'
import { AssigneePicker, DatePicker, PriorityPicker, StatusPicker, TaskDatesPicker } from '../../components/tasks/pickers'
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
      if (!taskId || event.task_id !== taskId) return
      if (event.type === 'task.deleted') {
        // The task is really gone — drop it from every cache.
        cleanupDeletedTask(queryClient, taskId)
      } else {
        invalidateTaskCaches(queryClient, taskId)
      }
    },
    [queryClient, taskId],
  )

  useEffect(() => {
    if (task) recordRecent({ type: 'task', id: task.id, label: task.title, sublabel: task.ref })
  }, [task?.id, task?.title])

  useEffect(() => {
    if (isError && error instanceof ApiError && error.status === 404) {
      cleanupDeletedTask(queryClient, taskId)
      toast.info('This task was deleted or is no longer available.')
      navigate(-1)
    }
  }, [error, isError, navigate, queryClient, taskId])

  // Optimistic field edits — the detail view (and every list showing this task)
  // reflects the change instantly, then reconciles in the background.
  const patch = useTaskPatch()
  const update = (body: Record<string, unknown>, apply?: (t: Task) => Task) =>
    patch.mutate({ taskId: taskId as string, body, apply })

  const [shareOpen, setShareOpen] = useState(false)
  const { org, workspace } = useCurrentContext()
  const project = useProject(task?.project_id)

  if (isLoading) return <CenteredSpinner />
  if (isError && error instanceof ApiError && error.status === 404) return <CenteredSpinner />
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

  const linkedCount = task.dependencies.length + task.dependents.length
  const canEdit = canEditProjectTasks(project.data?.my_role)

  return (
    <div className="flex h-full flex-col">
      {/* Top bar */}
      <div className="flex shrink-0 items-center gap-2 border-b border-ink-700 px-5 py-2.5 text-sm">
        <button onClick={() => navigate(-1)} className="btn-ghost !px-2" title="Back">
          <ArrowLeft size={16} />
        </button>
        <TaskTypeBadge type={task.task_type} withLabel />
        <FavoriteButton target={favoriteTaskTarget(task.id, task.title, task.ref)} />
        <span className="font-medium text-fg-secondary">{task.ref}</span>
        {task.is_private && (
          <span className="flex items-center gap-1 rounded bg-ink-800 px-1.5 py-0.5 text-[11px] text-amber-400">
            <Lock size={11} /> Private
          </span>
        )}
        <span className="flex-1" />
        <span className="hidden text-xs text-fg-muted md:inline">Created {formatDate(task.created_at)}</span>
        {canEdit && (
          <button className="btn-secondary !py-1 text-xs" onClick={() => setShareOpen(true)}>
            <Share2 size={14} /> Share
          </button>
        )}
        {canEdit ? (
          <DeleteTaskButton taskId={task.id} onDeleted={() => navigate(-1)} />
        ) : null}
        <button onClick={() => navigate(-1)} className="btn-ghost !px-2" title="Close">
          <X size={16} />
        </button>
      </div>

      <div className="grid min-h-0 flex-1 grid-cols-[1fr_360px] max-lg:grid-cols-1">
        {/* Main */}
        <div className="min-w-0 overflow-y-auto px-6 py-5">
          {!canEdit && (
            <div className="mb-4 flex items-center gap-2 rounded-lg border border-ink-700/80 bg-ink-900/50 px-3 py-1.5 text-xs text-fg-secondary">
              <Eye size={14} className="shrink-0 text-fg-muted" />
              View-only — you can read this task but cannot change it.
            </div>
          )}
          <EditableTitle
            value={task.title}
            completed={!!task.completed_at}
            readOnly={!canEdit}
            onSave={(title) => update({ title }, (t) => ({ ...t, title }))}
          />

          {/* Field grid (ClickUp-style) */}
          <div className="mt-5 grid grid-cols-2 gap-x-10 max-md:grid-cols-1">
            <Field label="Status">
              {canEdit ? (
                <StatusPicker
                  projectId={task.project_id}
                  value={task.status}
                  size="md"
                  onChange={(statusId, status) => {
                    void buildStatusUpdate(task, status).then((body) => {
                      if (body) update(body, withStatus(status))
                    })
                  }}
                />
              ) : (
                <StatusPill status={task.status} />
              )}
            </Field>
            <Field label="Assignees">
              {canEdit ? (
                <AssigneePicker task={task} size={24}>
                  <span className="cursor-pointer text-sm text-fg-muted hover:text-fg-secondary">+ Assign</span>
                </AssigneePicker>
              ) : (
                <span className="flex items-center gap-1.5 text-sm">
                  {task.assignees.length > 0 ? (
                    <AvatarStack users={task.assignees} size={24} />
                  ) : (
                    <span className="text-fg-muted">Unassigned</span>
                  )}
                </span>
              )}
            </Field>
            <Field label="Dates">
              <div className="flex items-center gap-1.5 text-sm">
                {canEdit ? (
                  <TaskDatesPicker
                    startDate={task.start_date}
                    dueDate={task.due_date}
                    completedAt={task.completed_at}
                    onSave={(body, apply) => update(body, apply)}
                  />
                ) : (
                  <span className="text-fg-secondary">
                    {task.start_date || task.due_date
                      ? `${task.start_date ? formatDate(task.start_date) : '—'} → ${task.due_date ? formatDate(task.due_date) : '—'}`
                      : '—'}
                  </span>
                )}
                {canEdit && task.due_date && <AddToCalendarButton taskId={task.id} />}
              </div>
            </Field>
            <Field label="Priority">
              {canEdit ? (
                <PriorityPicker value={task.priority} onChange={(p) => update(p ? { priority: p } : { clear_priority: true }, withPriority(p ?? null))}>
                  <span className="flex cursor-pointer items-center gap-1.5 text-sm text-fg-secondary">
                    <PriorityFlag priority={task.priority} withLabel />{!task.priority && 'Set priority'}
                  </span>
                </PriorityPicker>
              ) : (
                <PriorityFlag priority={task.priority} withLabel />
              )}
            </Field>
            <Field label="Time Estimate">
              <TimeEstimateField
                readOnly={!canEdit}
                value={task.time_estimate_seconds}
                onSave={(secs) =>
                  update(
                    secs === null ? { clear_time_estimate: true } : { time_estimate_seconds: secs },
                    (t) => ({ ...t, time_estimate_seconds: secs }),
                  )
                }
              />
            </Field>
            <Field label="Sprint Points">
              <PointsEditor
                readOnly={!canEdit}
                value={task.story_points}
                onSave={(p) => update({ story_points: p }, (t) => ({ ...t, story_points: p }))}
              />
            </Field>
            <Field label="Track Time">
              <span className="flex items-center gap-1.5 text-sm text-fg-secondary">
                <Timer size={14} />
                {task.total_tracked_seconds > 0 ? formatDuration(task.total_tracked_seconds) : canEdit ? 'Add time below' : '—'}
              </span>
            </Field>
            <Field label="Tags">
              <LabelsEditor
                readOnly={!canEdit}
                labels={task.labels}
                onSave={(labels) => update({ labels }, (t) => ({ ...t, labels }))}
              />
            </Field>
            <Field label="Sprint">
              <SprintRow task={task} canEdit={canEdit} />
            </Field>
            <Field label="Relationships">
              <span className="text-sm text-fg-muted">{linkedCount > 0 ? `${linkedCount} linked` : 'Empty'}</span>
            </Field>
          </div>

          <EditableDescription
            taskId={task.id}
            value={task.description ?? ''}
            readOnly={!canEdit}
            onSave={(description) => update({ description }, (t) => ({ ...t, description }))}
          />

          <Subtasks task={task} canEdit={canEdit} />
          <Checklists task={task} canEdit={canEdit} />
          <Dependencies task={task} canEdit={canEdit} />
          <Attachments task={task} canEdit={canEdit} />
          <TimeTracking task={task} canEdit={canEdit} />
          <TaskGithub
            task={task}
            canEdit={canEdit}
            onTaskUpdate={() => invalidateTaskCaches(queryClient, taskId)}
          />
          <TaskEmails task={task} />
        </div>

        {/* Activity sidebar */}
        <aside className="flex min-h-0 flex-col border-l border-ink-700 max-lg:max-h-[min(50vh,28rem)] max-lg:border-l-0 max-lg:border-t">
          <div className="shrink-0 border-b border-ink-700 px-4 py-3 text-sm font-semibold text-fg">Activity</div>
          <div className="flex min-h-0 flex-1 flex-col overflow-hidden px-4 py-3">
            <CommentSection taskId={task.id} projectId={task.project_id} canEdit={canEdit} />
          </div>
        </aside>
      </div>

      <ShareModal open={shareOpen && canEdit} onClose={() => setShareOpen(false)} taskId={task.id} taskTitle={task.title} />
    </div>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-3 border-b border-ink-800/60 py-2">
      <span className="w-32 shrink-0 text-sm text-fg-muted">{label}</span>
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  )
}

function TimeEstimateField({
  value,
  onSave,
  readOnly = false,
}: {
  value: number | null
  onSave: (seconds: number | null) => void
  readOnly?: boolean
}) {
  const initial = splitDurationParts(value ?? 0)
  const [editing, setEditing] = useState(false)
  const [days, setDays] = useState(String(initial.days || ''))
  const [hours, setHours] = useState(String(initial.hours || ''))
  const [minutes, setMinutes] = useState(String(initial.minutes || ''))
  const [seconds, setSeconds] = useState(String(initial.seconds || ''))

  const openEdit = () => {
    const parts = splitDurationParts(value ?? 0)
    setDays(parts.days ? String(parts.days) : '')
    setHours(parts.hours ? String(parts.hours) : '')
    setMinutes(parts.minutes ? String(parts.minutes) : '')
    setSeconds(parts.seconds ? String(parts.seconds) : '')
    setEditing(true)
  }

  const commit = () => {
    const total = combineDurationParts({
      days: Number(days) || 0,
      hours: Number(hours) || 0,
      minutes: Number(minutes) || 0,
      seconds: Number(seconds) || 0,
    })
    onSave(total > 0 ? total : null)
    setEditing(false)
  }

  if (readOnly) {
    return (
      <span className="flex items-center gap-1.5 text-sm text-fg-secondary">
        <Clock size={14} />
        {value ? formatDuration(value) : <span className="text-fg-muted">—</span>}
      </span>
    )
  }
  if (editing) {
    const unit = (label: string, val: string, set: (v: string) => void) => (
      <label className="flex items-center gap-1">
        <input
          type="number"
          min={0}
          autoFocus={label === 'd'}
          value={val}
          onChange={(e) => set(e.target.value.replace(/\D/g, ''))}
          onKeyDown={(e) => {
            if (e.key === 'Enter') commit()
            if (e.key === 'Escape') setEditing(false)
          }}
          className="input-dark !w-12 !py-1 text-center text-sm"
          placeholder="0"
        />
        <span className="text-[11px] text-fg-muted">{label}</span>
      </label>
    )
    return (
      <div
        className="flex flex-wrap items-center gap-1.5"
        onBlur={(e) => {
          if (!e.currentTarget.contains(e.relatedTarget as Node | null)) commit()
        }}
      >
        {unit('d', days, setDays)}
        {unit('h', hours, setHours)}
        {unit('m', minutes, setMinutes)}
        {unit('s', seconds, setSeconds)}
      </div>
    )
  }
  return (
    <button className="flex items-center gap-1.5 text-sm text-fg-secondary hover:text-fg" onClick={openEdit}>
      <Clock size={14} />
      {value ? formatDuration(value) : <span className="text-fg-muted">Empty</span>}
    </button>
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
      if (link) openExternalUrl(link)
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
function TaskGithub({
  task,
  canEdit,
  onTaskUpdate,
}: {
  task: TaskDetail
  canEdit: boolean
  onTaskUpdate: () => void
}) {
  const queryClient = useQueryClient()

  const repos = useQuery({
    queryKey: ['gh-proj-repos', task.project_id],
    queryFn: () => api.get<RepoOut[]>(`/github/projects/${task.project_id}/repositories`),
    staleTime: 0,
    refetchOnMount: 'always',
  })
  const events = useQuery({
    queryKey: ['task-github-events', task.id],
    queryFn: () => api.get<TaskGithubEvent[]>(`/github/tasks/${task.id}/events`),
  })
  const branchNameQuery = useQuery({
    queryKey: ['task-branch-name', task.id],
    queryFn: () => api.get<{ branch_name: string }>(`/github/tasks/${task.id}/branch-name`),
  })

  const projectRepos = Array.isArray(repos.data) ? repos.data.filter((r) => r.is_active) : []
  const activeProjectRepo = projectRepos[0] ?? null
  const branch = branchNameQuery.data?.branch_name ?? branchNameFor(task)

  useQuery({
    queryKey: ['task-github-issue-sync', task.id],
    queryFn: async () => {
      const data = await api.post<{ updated: boolean }>(`/github/tasks/${task.id}/sync-issue-status`)
      if (data.updated) onTaskUpdate()
      return data
    },
    enabled: !!task.github_issue_number && !!activeProjectRepo,
    staleTime: 30_000,
    refetchOnWindowFocus: true,
  })

  useQuery({
    queryKey: ['task-github-sub-issues-sync', task.id],
    queryFn: async () => {
      const data = await api.post<{ imported: number }>(`/github/tasks/${task.id}/sync-sub-issues`)
      if (data.imported > 0) onTaskUpdate()
      return data
    },
    enabled: !!task.github_issue_number && !task.parent_task_id && !!activeProjectRepo,
    staleTime: 30_000,
    refetchOnWindowFocus: true,
  })

  useQuery({
    queryKey: ['task-github-comments-sync', task.id],
    queryFn: async () => {
      const data = await api.post<{ imported: number }>(`/github/tasks/${task.id}/sync-issue-comments`)
      if (data.imported > 0) {
        void queryClient.invalidateQueries({ queryKey: ['github-comments', task.id] })
      }
      return data
    },
    enabled: !!task.github_issue_number && !!activeProjectRepo,
    staleTime: 30_000,
    refetchOnWindowFocus: true,
  })

  type RepoTarget = { body: { repository_id: string }; full_name: string }
  const target: RepoTarget | null = activeProjectRepo
    ? { body: { repository_id: activeProjectRepo.id }, full_name: activeProjectRepo.repo_full_name }
    : null

  const isCompleted = task.status?.category === 'done'

  const createBranch = useMutation({
    mutationFn: (body: Record<string, unknown>) =>
      api.post<{ branch: string; url: string }>(`/github/tasks/${task.id}/create-branch`, body),
    onSuccess: (data) => {
      toast.success(`Branch ready: ${data.branch}`)
      openExternalUrl(data.url)
    },
    onError: (err) => toast.error(errorMessage(err)),
  })

  const reopenIssue = useMutation({
    mutationFn: () =>
      api.post<{ updated: boolean; status_id?: string | null }>(`/github/tasks/${task.id}/reopen-issue`),
    onSuccess: (data) => {
      if (data.updated) {
        toast.success('Issue reopened — task moved to To Do')
      } else {
        toast.info('Issue reopened on GitHub')
      }
      invalidateTaskCaches(queryClient, task.id)
      void queryClient.invalidateQueries({ queryKey: ['task-github-events', task.id] })
    },
    onError: (err) => toast.error(errorMessage(err)),
  })

  const hasEvents = (events.data ?? []).length > 0

  if (!task.github_issue_number) return null

  const runCreateBranch = () => {
    if (!target) {
      toast.error('Link a repository to this project in App Center first.')
      return
    }
    createBranch.mutate({ ...target.body, branch_name: branch })
  }

  return (
    <div className="mt-8">
      <h3 className="mb-2 flex items-center gap-2 text-sm font-semibold text-fg">
        <GitBranch size={14} className="text-fg-secondary" /> Development
      </h3>

      {activeProjectRepo ? (
        <div className="mb-2 space-y-2">
          <div className="flex items-center gap-2 rounded-lg border border-ink-700 bg-ink-900 px-3 py-2">
            <GitHubIcon size={13} className="shrink-0 text-fg-secondary" />
            <span className="min-w-0 flex-1 truncate text-sm text-fg">{activeProjectRepo.repo_full_name}</span>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {canEdit ? (
              <>
                <button
                  type="button"
                  className="btn-secondary !py-1 text-xs"
                  disabled={createBranch.isPending}
                  onClick={runCreateBranch}
                >
                  {createBranch.isPending ? 'Creating…' : 'Create branch'}
                </button>

                {isCompleted ? (
                  <button
                    type="button"
                    className="btn-secondary !py-1 text-xs"
                    disabled={reopenIssue.isPending}
                    onClick={() => reopenIssue.mutate()}
                  >
                    {reopenIssue.isPending ? 'Reopening…' : 'Reopen issue'}
                  </button>
                ) : null}
              </>
            ) : null}

            <a
              className="btn-secondary flex items-center gap-1 !py-1 text-xs"
              href={
                safeHttpUrl(task.github_issue_url) ??
                safeGithubUrl(
                  `https://github.com/${target?.full_name ?? activeProjectRepo.repo_full_name}/issues/${task.github_issue_number}`,
                ) ??
                undefined
              }
              target="_blank"
              rel={EXTERNAL_LINK_REL}
            >
              Issue #{task.github_issue_number}
            </a>
          </div>

          <TaskGithubCommentThread taskId={task.id} />

          <GithubIssueCommentBox
            taskId={task.id}
            canEdit={canEdit}
            isCompleted={isCompleted}
            onUpdated={onTaskUpdate}
          />
        </div>
      ) : repos.isLoading ? (
        <p className="mb-2 text-xs text-fg-muted">Loading linked repository…</p>
      ) : (
        <div className="mb-2 space-y-2">
          <a
            className="btn-secondary inline-flex items-center gap-1 !py-1 text-xs"
            href={safeHttpUrl(task.github_issue_url) ?? undefined}
            target="_blank"
            rel={EXTERNAL_LINK_REL}
          >
            Issue #{task.github_issue_number}
          </a>
        </div>
      )}

      {hasEvents ? (
        <div className="overflow-hidden rounded-xl border border-ink-700">
          {(events.data ?? []).map((event) => (
            <a
              key={event.id}
              href={safeGithubUrl(event.payload.url as string) ?? undefined}
              target="_blank"
              rel={EXTERNAL_LINK_REL}
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
      ) : null}
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
              href={safeHttpUrl(mail.link) ?? undefined}
              target="_blank"
              rel={EXTERNAL_LINK_REL}
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
function SprintRow({ task, canEdit }: { task: TaskDetail; canEdit: boolean }) {
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
          {canEdit && sprint.status !== 'completed' && (
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
      {canEdit && addable.length > 0 && (
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
  readOnly = false,
  onSave,
}: {
  value: string
  completed: boolean
  readOnly?: boolean
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
      onClick={() => !readOnly && setEditing(true)}
      className={cn(
        'text-2xl font-bold leading-tight text-fg',
        !readOnly && 'cursor-text',
      )}
    >
      {value}
    </h1>
  )
}

function EditableDescription({
  taskId,
  value,
  readOnly = false,
  onSave,
}: {
  taskId: string
  value: string
  readOnly?: boolean
  onSave: (d: string) => void
}) {
  const queryClient = useQueryClient()
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(value)
  const [uploadingImages, setUploadingImages] = useState(0)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const placeholderSeq = useRef(0)
  useEffect(() => setDraft(value), [value])

  const insertAtCursor = (text: string) => {
    const el = textareaRef.current
    setDraft((current) => {
      const pos = el ? el.selectionStart : current.length
      const before = current.slice(0, pos)
      const after = current.slice(pos)
      const lead = before && !before.endsWith('\n') ? '\n' : ''
      return `${before}${lead}${text}\n${after}`
    })
  }

  // Pasted images upload to the task's attachments and land in the text as
  // ![name](attachment-id) markup, rendered inline by DescriptionBody.
  const uploadPastedImage = async (file: File) => {
    const placeholder = `![Uploading ${file.name}…](pending-${++placeholderSeq.current})`
    insertAtCursor(placeholder)
    setUploadingImages((n) => n + 1)
    try {
      const form = new FormData()
      form.append('file', file)
      const attachment = await api.upload<Attachment>(`/tasks/${taskId}/attachments`, form)
      setDraft((current) => current.replace(placeholder, `![${attachment.file_name}](${attachment.id})`))
      void queryClient.invalidateQueries({ queryKey: ['task', taskId] })
    } catch (err) {
      setDraft((current) => current.replace(placeholder, '').replace(/\n\n+/g, '\n\n'))
      toast.error(errorMessage(err))
    } finally {
      setUploadingImages((n) => n - 1)
    }
  }

  const onPaste = (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
    const files = Array.from(e.clipboardData?.files ?? []).filter((f) => f.type.startsWith('image/'))
    if (files.length === 0) return
    e.preventDefault()
    for (const file of files) void uploadPastedImage(file)
  }

  if (editing) {
    return (
      <div className="mt-4">
        <textarea
          autoFocus
          ref={textareaRef}
          rows={6}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onPaste={onPaste}
          className="input-dark resize-y"
          placeholder="Add a description…"
        />
        <p className="mt-1 text-[11px] text-fg-muted">
          {uploadingImages > 0 ? (
            <span className="flex items-center gap-1 text-fg-secondary">
              <Loader2 size={11} className="animate-spin" /> Uploading image…
            </span>
          ) : (
            'Paste an image to embed it — it is stored with the task attachments.'
          )}
        </p>
        <div className="mt-2 flex gap-2">
          <button
            className="btn-primary !py-1.5 text-xs"
            disabled={uploadingImages > 0}
            onClick={() => {
              onSave(draft)
              setEditing(false)
            }}
          >
            Save
          </button>
          <button
            className="btn-ghost text-xs"
            disabled={uploadingImages > 0}
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
      onClick={() => !readOnly && setEditing(true)}
      className={cn(
        'mt-4 min-h-[60px] rounded-lg border border-transparent px-3 py-2 -mx-3 transition-colors',
        !readOnly && 'cursor-text hover:border-ink-700 hover:bg-ink-850/50',
      )}
    >
      {value ? (
        <DescriptionBody text={value} />
      ) : (
        <p className="text-sm text-fg-muted">Add a description…</p>
      )}
    </div>
  )
}

/** Inline-image markup in task descriptions: ![label](attachment-uuid). */
const DESCRIPTION_IMAGE_RE = /!\[([^\]]*)\]\(([0-9a-fA-F]{8}(?:-[0-9a-fA-F]{4}){3}-[0-9a-fA-F]{12})\)/g

function DescriptionBody({ text }: { text: string }) {
  const parts: React.ReactNode[] = []
  const re = new RegExp(DESCRIPTION_IMAGE_RE.source, 'g')
  let last = 0
  let match: RegExpExecArray | null
  while ((match = re.exec(text))) {
    if (match.index > last) parts.push(<span key={`t-${last}`}>{text.slice(last, match.index)}</span>)
    parts.push(<DescriptionImage key={`img-${match.index}-${match[2]}`} attachmentId={match[2]} label={match[1]} />)
    last = match.index + match[0].length
  }
  if (last < text.length) parts.push(<span key={`t-${last}`}>{text.slice(last)}</span>)
  return <p className="whitespace-pre-wrap text-sm leading-relaxed text-fg-secondary">{parts}</p>
}

/** Streams the image through the authenticated download endpoint (a plain
 * <img src> can't send the bearer token) and renders it inline. */
function DescriptionImage({ attachmentId, label }: { attachmentId: string; label: string }) {
  const [url, setUrl] = useState<string | null>(null)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    let objectUrl: string | null = null
    let cancelled = false
    setUrl(null)
    setFailed(false)
    api
      .get<Blob>(`/attachments/${attachmentId}/download`)
      .then((blob) => {
        if (cancelled) return
        objectUrl = URL.createObjectURL(blob)
        setUrl(objectUrl)
      })
      .catch(() => setFailed(true))
    return () => {
      cancelled = true
      if (objectUrl) URL.revokeObjectURL(objectUrl)
    }
  }, [attachmentId])

  if (failed) {
    return (
      <span className="my-1 inline-flex items-center gap-1.5 rounded-md border border-ink-700 bg-ink-850 px-2 py-1 text-xs text-fg-muted">
        <Paperclip size={11} /> {label || 'Image unavailable'}
      </span>
    )
  }
  if (!url) {
    return <span aria-label="Loading image" className="my-2 block h-32 w-48 animate-pulse rounded-lg bg-ink-800" />
  }
  return (
    <span className="my-2 block" onClick={(e) => e.stopPropagation()}>
      <img
        src={url}
        alt={label}
        title={label}
        className="max-h-72 max-w-full rounded-lg border border-ink-700 object-contain"
      />
    </span>
  )
}

function PointsEditor({
  value,
  onSave,
  readOnly = false,
}: {
  value: number | null
  onSave: (p: number) => void
  readOnly?: boolean
}) {
  const [draft, setDraft] = useState(value?.toString() ?? '')
  useEffect(() => setDraft(value?.toString() ?? ''), [value])
  if (readOnly) {
    return <span className="text-sm text-fg-secondary">{value ?? '—'}</span>
  }
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

function LabelsEditor({
  labels,
  onSave,
  readOnly = false,
}: {
  labels: string[]
  onSave: (labels: string[]) => void
  readOnly?: boolean
}) {
  const [adding, setAdding] = useState(false)
  const [draft, setDraft] = useState('')
  if (readOnly) {
    return labels.length > 0 ? (
      <div className="flex flex-wrap items-center gap-1.5">
        {labels.map((label) => (
          <LabelChip key={label} label={label} />
        ))}
      </div>
    ) : (
      <span className="text-sm text-fg-muted">—</span>
    )
  }
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

function Subtasks({ task, canEdit }: { task: TaskDetail; canEdit: boolean }) {
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  const patch = useTaskPatch()
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
      invalidateTaskCaches(queryClient, task.id)
    } catch (err) {
      toast.error(errorMessage(err))
    }
  }

  const updateSubtask = (
    subtask: Task,
    body: Record<string, unknown>,
    apply?: (t: Task) => Task,
  ) => {
    patch.mutate(
      {
        taskId: subtask.id,
        body,
        apply: apply
          ? (t) => {
              const next = apply(t)
              queryClient.setQueryData<TaskDetail>(['task', task.id], (parent) => {
                if (!parent) return parent
                return {
                  ...parent,
                  subtasks: parent.subtasks.map((s) => (s.id === subtask.id ? { ...s, ...next } : s)),
                }
              })
              return next
            }
          : undefined,
      },
      {
        onSettled: () => {
          void queryClient.invalidateQueries({ queryKey: ['task', task.id] })
        },
      },
    )
  }

  if (task.parent_task_id) return null

  return (
    <section className="mt-7">
      <h3 className="mb-2 flex items-center gap-2 text-sm font-semibold text-fg">
        <SubtaskIcon size={15} /> Subtasks
        <span className="text-xs font-normal text-fg-muted">
          {task.subtasks.filter((s) => s.completed_at).length}/{task.subtasks.length}
        </span>
      </h3>
      <div className="overflow-hidden rounded-xl border border-ink-700">
        {task.subtasks.map((subtask) => {
          const overdue = isOverdue(subtask.due_date, subtask.completed_at)
          return (
            <div
              key={subtask.id}
              className="grid items-center gap-3 border-b border-ink-700/60 bg-ink-900 px-3.5 py-2 last:border-b-0 hover:bg-ink-850"
              style={{ gridTemplateColumns: 'minmax(64px, auto) minmax(0, 1fr) 72px 88px 56px minmax(112px, auto)' }}
            >
              <span className="shrink-0 truncate text-xs text-fg-muted">{subtask.ref}</span>
              <button
                type="button"
                onClick={() => navigate(`/app/tasks/${subtask.id}`)}
                className="min-w-0 truncate text-left text-sm text-fg hover:text-brand"
                title="Open subtask details"
              >
                {subtask.title}
              </button>

              <div className="flex justify-center" onClick={(e) => e.stopPropagation()}>
                {canEdit ? (
                  <AssigneePicker task={subtask} size={20}>
                    {subtask.assignees.length > 0 ? (
                      <span className="inline-flex cursor-pointer">
                        <AvatarStack users={subtask.assignees} size={20} max={2} />
                      </span>
                    ) : (
                      <span className="flex h-6 w-6 items-center justify-center rounded-full border border-dashed border-ink-600 text-fg-muted transition-colors hover:border-fg-muted hover:text-fg-secondary">
                        <UserPlus size={11} />
                      </span>
                    )}
                  </AssigneePicker>
                ) : (
                  <AvatarStack users={subtask.assignees} size={20} max={2} />
                )}
              </div>

              <div className="flex justify-center" onClick={(e) => e.stopPropagation()}>
                {canEdit ? (
                  <DatePicker
                    value={subtask.due_date}
                    onChange={(d) =>
                      updateSubtask(
                        subtask,
                        d ? { due_date: d } : { clear_due_date: true },
                        withDueDate(d ?? null),
                      )
                    }
                  >
                    {subtask.due_date ? (
                      <span
                        className={cn(
                          'cursor-pointer whitespace-nowrap text-xs',
                          overdue ? 'font-medium text-red-400' : 'text-fg-secondary',
                        )}
                      >
                        {formatDate(subtask.due_date)}
                      </span>
                    ) : (
                      <span className="flex h-6 w-6 cursor-pointer items-center justify-center rounded-md border border-dashed border-ink-600 text-fg-muted hover:border-fg-muted hover:text-fg-secondary">
                        <Calendar size={12} />
                      </span>
                    )}
                  </DatePicker>
                ) : (
                  <span className="text-xs text-fg-secondary">{formatDate(subtask.due_date)}</span>
                )}
              </div>

              <div className="flex justify-center" onClick={(e) => e.stopPropagation()}>
                {canEdit ? (
                  <PriorityPicker
                    value={subtask.priority}
                    onChange={(p) =>
                      updateSubtask(
                        subtask,
                        p ? { priority: p } : { clear_priority: true },
                        withPriority(p ?? null),
                      )
                    }
                  >
                    {subtask.priority ? (
                      <span className="inline-flex cursor-pointer">
                        <PriorityFlag priority={subtask.priority} />
                      </span>
                    ) : (
                      <span className="flex h-6 w-6 cursor-pointer items-center justify-center rounded-md border border-dashed border-ink-500 text-fg-muted transition-colors hover:border-fg-muted hover:text-fg-secondary">
                        <Flag size={12} strokeWidth={2} />
                      </span>
                    )}
                  </PriorityPicker>
                ) : (
                  <PriorityFlag priority={subtask.priority} />
                )}
              </div>

              <div className="flex justify-end" onClick={(e) => e.stopPropagation()}>
                {canEdit ? (
                  <StatusPicker
                    projectId={subtask.project_id}
                    value={subtask.status}
                    size="sm"
                    onChange={(statusId, status) => {
                      void buildStatusUpdate(subtask, status).then((body) => {
                        if (body) updateSubtask(subtask, body, withStatus(status))
                      })
                    }}
                  />
                ) : (
                  <StatusPill status={subtask.status} />
                )}
              </div>
            </div>
          )
        })}
        {canEdit ? (
          adding ? (
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
              type="button"
              onClick={() => setAdding(true)}
              className="flex w-full items-center gap-2 px-3.5 py-2 text-sm text-fg-muted transition-colors hover:bg-ink-850 hover:text-fg-secondary"
            >
              <Plus size={14} /> Add subtask
            </button>
          )
        ) : null}
      </div>
    </section>
  )
}

function Dependencies({ task, canEdit }: { task: TaskDetail; canEdit: boolean }) {
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
    if (!canEdit) return null
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
            {canEdit && (
              <button
                className="hidden text-fg-muted hover:text-red-400 group-hover:block"
                onClick={() => removeDep(dep.id)}
              >
                <X size={13} />
              </button>
            )}
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
        {canEdit && (adding ? (
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
        ))}
      </div>
    </section>
  )
}

const TEXT_PREVIEW_LIMIT = 512 * 1024 // cap inline text rendering at 512KB

type PreviewKind = 'image' | 'pdf' | 'video' | 'audio' | 'text' | 'unsupported'

interface AttachmentPreview {
  attachmentId: string
  fileName: string
  kind: PreviewKind
  url: string | null
  text?: string
  truncated?: boolean
}

/** Pick an inline renderer from the server-resolved MIME, falling back to the
 *  declared type and finally the file extension (octet-stream uploads). */
function previewKind(mime: string, fileName: string): PreviewKind {
  const m = (mime || '').split(';', 1)[0].trim().toLowerCase()
  if (m.startsWith('image/')) return 'image'
  if (m === 'application/pdf') return 'pdf'
  if (m.startsWith('video/')) return 'video'
  if (m.startsWith('audio/')) return 'audio'
  if (m.startsWith('text/') || m === 'application/json' || m === 'application/xml') return 'text'
  const ext = (fileName.toLowerCase().split('.').pop() ?? '')
  if (['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp', 'avif'].includes(ext)) return 'image'
  if (ext === 'pdf') return 'pdf'
  if (['mp4', 'webm', 'ogv', 'mov'].includes(ext)) return 'video'
  if (['mp3', 'wav', 'm4a', 'oga', 'ogg'].includes(ext)) return 'audio'
  if (['txt', 'md', 'csv', 'json', 'xml', 'log', 'yml', 'yaml'].includes(ext)) return 'text'
  return 'unsupported'
}

function Attachments({ task, canEdit }: { task: TaskDetail; canEdit: boolean }) {
  const queryClient = useQueryClient()
  const fileRef = useRef<HTMLInputElement>(null)
  const [uploading, setUploading] = useState(false)
  const [preview, setPreview] = useState<AttachmentPreview | null>(null)
  const [loadingId, setLoadingId] = useState<string | null>(null)
  const previewUrlRef = useRef<string | null>(null)
  const previewReqRef = useRef(0)

  const revokePreviewUrl = () => {
    if (previewUrlRef.current) {
      URL.revokeObjectURL(previewUrlRef.current)
      previewUrlRef.current = null
    }
  }

  const closePreview = () => {
    previewReqRef.current += 1 // invalidate any in-flight fetch
    revokePreviewUrl()
    setPreview(null)
    setLoadingId(null)
  }

  // Revoke the last object URL when the task page unmounts.
  useEffect(() => () => revokePreviewUrl(), [])

  // Esc collapses the inline preview.
  useEffect(() => {
    if (!preview && !loadingId) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closePreview()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [preview, loadingId])

  // Toggle an inline preview under the attachment row. Streams the file through
  // the authenticated download endpoint (so the blob carries the server-sniffed
  // Content-Type) and renders it in place — never a browser download or new tab.
  // Works for both local and S3 storage.
  const togglePreview = async (attachment: { id: string; file_name: string; mime_type: string }) => {
    if (preview?.attachmentId === attachment.id || loadingId === attachment.id) {
      closePreview() // clicking the eye on the open file collapses it
      return
    }
    const reqId = ++previewReqRef.current
    revokePreviewUrl()
    setPreview(null)
    setLoadingId(attachment.id)
    try {
      const blob = await api.get<Blob>(`/attachments/${attachment.id}/download`)
      if (previewReqRef.current !== reqId) return // superseded or closed
      const kind = previewKind(blob.type || attachment.mime_type, attachment.file_name)
      if (kind === 'text') {
        const truncated = blob.size > TEXT_PREVIEW_LIMIT
        const text = await (truncated ? blob.slice(0, TEXT_PREVIEW_LIMIT) : blob).text()
        if (previewReqRef.current !== reqId) return
        setPreview({ attachmentId: attachment.id, fileName: attachment.file_name, kind, url: null, text, truncated })
      } else {
        const url = URL.createObjectURL(blob)
        previewUrlRef.current = url
        setPreview({ attachmentId: attachment.id, fileName: attachment.file_name, kind, url })
      }
    } catch (err) {
      if (previewReqRef.current === reqId) toast.error(errorMessage(err))
    } finally {
      if (previewReqRef.current === reqId) setLoadingId(null)
    }
  }

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

  if (task.attachments.length === 0 && !canEdit) return null

  return (
    <section className="mt-7">
      <h3 className="mb-2 flex items-center gap-2 text-sm font-semibold text-fg">
        <Paperclip size={15} /> Attachments
        <span className="text-xs font-normal text-fg-muted">{task.attachments.length}</span>
        <span className="flex-1" />
        {canEdit && (
          <>
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
          </>
        )}
      </h3>
      {task.attachments.length > 0 && (
        <div className="space-y-1.5">
          {task.attachments.map((attachment) => {
            const isLoading = loadingId === attachment.id
            const isOpen = preview?.attachmentId === attachment.id
            return (
              <div key={attachment.id} className="space-y-1.5">
                <div className="group flex items-center gap-3 rounded-lg border border-ink-700 bg-ink-900 px-3 py-2">
                  <Paperclip size={14} className="shrink-0 text-fg-muted" />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm text-fg">{attachment.file_name}</p>
                    <p className="text-[11px] text-fg-muted">
                      {formatBytes(attachment.size_bytes)} ·{' '}
                      {attachment.uploader?.full_name || 'unknown'} · {formatDate(attachment.created_at)}
                    </p>
                  </div>
                  <button
                    className={cn('btn-ghost !px-2 !py-1', (isOpen || isLoading) && 'bg-ink-700 text-fg')}
                    title={isOpen || isLoading ? 'Hide preview' : 'Preview'}
                    onClick={() => togglePreview(attachment)}
                  >
                    <Eye size={14} />
                  </button>
                  <button
                    className="btn-ghost !px-2 !py-1"
                    title="Download"
                    onClick={() => download(attachment.id, attachment.file_name)}
                  >
                    <Download size={14} />
                  </button>
                  {canEdit && (
                    <button
                      className="hidden text-fg-muted hover:text-red-400 group-hover:block"
                      onClick={() => remove(attachment.id)}
                    >
                      <Trash2 size={14} />
                    </button>
                  )}
                </div>

                {(isOpen || isLoading) && (
                  <div className="overflow-hidden rounded-lg border border-ink-700 bg-ink-950">
                    {isLoading && (
                      <p className="px-3 py-8 text-center text-xs text-fg-muted">Loading preview…</p>
                    )}

                    {isOpen && preview && (
                      <div className="flex max-h-[70vh] items-center justify-center overflow-auto p-3">
                        {preview.kind === 'image' && preview.url && (
                          <img
                            src={preview.url}
                            alt={preview.fileName}
                            className="max-h-[66vh] max-w-full rounded object-contain"
                          />
                        )}

                        {preview.kind === 'pdf' && preview.url && (
                          <iframe
                            title={preview.fileName}
                            src={preview.url}
                            className="h-[66vh] w-full rounded bg-white"
                          />
                        )}

                        {preview.kind === 'video' && preview.url && (
                          <video src={preview.url} controls className="max-h-[66vh] max-w-full rounded" />
                        )}

                        {preview.kind === 'audio' && preview.url && (
                          <audio src={preview.url} controls className="w-full" />
                        )}

                        {preview.kind === 'text' && (
                          <pre className="max-h-[66vh] w-full overflow-auto whitespace-pre-wrap break-words rounded bg-ink-900 p-3 text-left text-xs leading-relaxed text-fg-secondary">
                            {preview.text}
                            {preview.truncated && (
                              <span className="mt-3 block text-fg-muted">
                                … preview truncated. Download to view the full file.
                              </span>
                            )}
                          </pre>
                        )}

                        {preview.kind === 'unsupported' && (
                          <div className="flex flex-col items-center gap-3 py-8 text-center text-fg-secondary">
                            <p className="text-sm">Preview isn't available for this file type.</p>
                            <button
                              className="btn-primary !py-1.5"
                              onClick={() => download(preview.attachmentId, preview.fileName)}
                            >
                              <Download size={14} /> Download
                            </button>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}
    </section>
  )
}

function TimeTracking({ task, canEdit }: { task: TaskDetail; canEdit: boolean }) {
  const queryClient = useQueryClient()
  const runningTimer = useRunningTimer()
  const entries = useQuery({
    queryKey: ['time-entries', task.id],
    queryFn: () => api.get<Page<TimeEntry>>(`/tasks/${task.id}/time-entries?page_size=20`),
  })

  const running = runningTimer.data
  const runningHere = running?.task_id === task.id
  const hasEntries = (entries.data?.items ?? []).length > 0
  if (!canEdit && !hasEntries && !runningHere) return null

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
        {canEdit && (runningHere ? (
          <button className="btn-secondary !border-red-500/40 !py-1 text-xs !text-red-400" onClick={stop}>
            <Square size={11} fill="currentColor" /> Stop timer
          </button>
        ) : (
          <button className="btn-ghost !py-1 text-xs" disabled={!!running} onClick={start} title={running ? 'Stop your other timer first' : undefined}>
            <Play size={12} /> Start timer
          </button>
        ))}
      </h3>
      {hasEntries && (
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
  const [deleting, setDeleting] = useState(false)

  const remove = async () => {
    setDeleting(true)
    try {
      await api.delete(`/tasks/${taskId}`)
      toast.success('Task deleted')
      cleanupDeletedTask(queryClient, taskId)
      onDeleted()
    } catch (err) {
      toast.error(errorMessage(err))
      setDeleting(false)
    }
  }

  if (confirming) {
    return (
      <span className="flex items-center gap-2 text-xs">
        <span className="text-fg-secondary">{deleting ? 'Deleting task…' : 'Delete this task?'}</span>
        <button
          className="flex items-center gap-1 font-semibold text-red-400 hover:text-red-300 disabled:opacity-60"
          disabled={deleting}
          onClick={remove}
        >
          {deleting && <Loader2 size={12} className="animate-spin" />}
          {deleting ? 'Deleting…' : 'Delete'}
        </button>
        <button
          className="text-fg-muted hover:text-fg disabled:opacity-60"
          disabled={deleting}
          onClick={() => setConfirming(false)}
        >
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
