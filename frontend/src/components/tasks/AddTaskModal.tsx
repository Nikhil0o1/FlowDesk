import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Calendar, Clock, Flag, Loader2, Plus, Tag, UserPlus, X } from 'lucide-react'
import { useState } from 'react'
import { useNavigate } from 'react-router-dom'

import { api, errorMessage } from '../../lib/api'
import { invalidateMyTasks } from '../../lib/myTasksQueries'
import { useCurrentContext, useProjects } from '../../lib/queries'
import type { CustomStatus, Priority, Task } from '../../lib/types'
import { cn, formatDate, PRIORITY_COLORS, PRIORITY_LABELS } from '../../lib/utils'
import { toast } from '../../stores/toast'
import { Modal } from '../ui/Modal'
import { DurationPartsInputs } from '../ui/DurationPartsInputs'
import { CreateAssigneePicker, DatePicker, PriorityPicker, StatusPicker } from './pickers'

/** ClickUp-style create-task modal: name plus every create-time field the API
 * accepts (description, status, assignees, priority, dates, estimate, labels).
 * With a fixed `projectId` it creates in that project; without one it shows a
 * project select (My Tasks surfaces). */
export function AddTaskModal({
  projectId: fixedProjectId,
  open,
  onClose,
  createGithubIssue = false,
  defaultAssigneeIds,
  navigateToTask = true,
  onCreated,
}: {
  projectId?: string
  open: boolean
  onClose: () => void
  createGithubIssue?: boolean
  defaultAssigneeIds?: string[]
  navigateToTask?: boolean
  onCreated?: (task: Task) => void
}) {
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  const { workspace } = useCurrentContext()
  const projects = useProjects(fixedProjectId ? undefined : workspace?.id)

  const [selectedProjectId, setSelectedProjectId] = useState('')
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [status, setStatus] = useState<CustomStatus | null>(null)
  const [assigneeIds, setAssigneeIds] = useState<string[]>(defaultAssigneeIds ?? [])
  const [priority, setPriority] = useState<Priority | null>(null)
  const [startDate, setStartDate] = useState<string | null>(null)
  const [dueDate, setDueDate] = useState<string | null>(null)
  const [estimateSeconds, setEstimateSeconds] = useState(0)
  const [labels, setLabels] = useState<string[]>([])
  const [labelDraft, setLabelDraft] = useState('')

  const projectId = fixedProjectId || selectedProjectId || projects.data?.[0]?.id || ''

  const reset = () => {
    setTitle('')
    setDescription('')
    setStatus(null)
    setAssigneeIds(defaultAssigneeIds ?? [])
    setPriority(null)
    setStartDate(null)
    setDueDate(null)
    setEstimateSeconds(0)
    setLabels([])
    setLabelDraft('')
  }

  const commitLabel = () => {
    const label = labelDraft.trim()
    if (label && !labels.includes(label) && labels.length < 20) setLabels([...labels, label])
    setLabelDraft('')
  }

  const create = useMutation({
    mutationFn: () =>
      api.post<Task>(`/projects/${projectId}/tasks`, {
        title: title.trim(),
        create_github_issue: createGithubIssue,
        ...(description.trim() ? { description: description.trim() } : {}),
        ...(status ? { status_id: status.id } : {}),
        ...(assigneeIds.length ? { assignee_ids: assigneeIds } : {}),
        ...(priority ? { priority } : {}),
        ...(startDate ? { start_date: startDate } : {}),
        ...(dueDate ? { due_date: dueDate } : {}),
        ...(estimateSeconds > 0 ? { time_estimate_seconds: estimateSeconds } : {}),
        ...(labels.length ? { labels } : {}),
      }),
    onSuccess: (task) => {
      toast.success(`${task.ref} created`)
      reset()
      void queryClient.invalidateQueries({ queryKey: ['tasks'] })
      invalidateMyTasks(queryClient)
      onClose()
      onCreated?.(task)
      if (navigateToTask) navigate(`/app/tasks/${task.id}`)
    },
    onError: (err) => toast.error(errorMessage(err)),
  })

  const canSubmit = !!projectId && !!title.trim() && !create.isPending
  const submit = () => canSubmit && create.mutate()

  // Switching projects invalidates project-scoped choices (status, members).
  const changeProject = (id: string) => {
    setSelectedProjectId(id)
    setStatus(null)
    setAssigneeIds(defaultAssigneeIds ?? [])
  }

  const chipClass =
    'flex items-center gap-1.5 rounded-lg border border-ink-600 px-2.5 py-1.5 text-xs font-medium text-fg-secondary transition-colors hover:border-fg-muted hover:text-fg'

  return (
    <Modal open={open} onClose={onClose} title="Create Task" width="max-w-2xl">
      <div className="space-y-3">
        {!fixedProjectId &&
          ((projects.data ?? []).length === 0 && !projects.isLoading ? (
            <p className="text-sm text-fg-muted">You don&apos;t have access to any projects yet.</p>
          ) : (
            <select
              className="input-dark text-sm"
              value={projectId}
              onChange={(e) => changeProject(e.target.value)}
              aria-label="Project"
            >
              {(projects.data ?? []).map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          ))}

        <input
          autoFocus
          className="input-dark text-base font-medium"
          placeholder="Task Name"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && submit()}
        />

        <textarea
          className="input-dark min-h-[88px] resize-none text-sm"
          placeholder="Add description"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
        />

        {projectId && (
          <div className="flex flex-wrap items-center gap-1.5">
            <StatusPicker projectId={projectId} value={status} onChange={(_, s) => setStatus(s)} />

            <CreateAssigneePicker projectId={projectId} value={assigneeIds} onChange={setAssigneeIds}>
              <button type="button" className={chipClass} title="Assignees">
                <UserPlus size={13} />
                {assigneeIds.length > 0
                  ? `${assigneeIds.length} assignee${assigneeIds.length > 1 ? 's' : ''}`
                  : 'Assignee'}
              </button>
            </CreateAssigneePicker>

            <PriorityPicker value={priority} onChange={setPriority}>
              <button type="button" className={cn(chipClass, priority && 'text-fg')} title="Priority">
                <Flag
                  size={13}
                  style={priority ? { color: PRIORITY_COLORS[priority] } : undefined}
                  fill={priority ? PRIORITY_COLORS[priority] : 'none'}
                />
                {priority ? PRIORITY_LABELS[priority] : 'Priority'}
              </button>
            </PriorityPicker>

            <DatePicker value={startDate} onChange={setStartDate} clearLabel="Clear start">
              <button type="button" className={cn(chipClass, startDate && 'text-fg')} title="Start date">
                <Calendar size={13} />
                {startDate ? `Start ${formatDate(startDate)}` : 'Start date'}
              </button>
            </DatePicker>

            <DatePicker value={dueDate} onChange={setDueDate} clearLabel="Clear due">
              <button type="button" className={cn(chipClass, dueDate && 'text-fg')} title="Due date">
                <Calendar size={13} />
                {dueDate ? `Due ${formatDate(dueDate)}` : 'Due date'}
              </button>
            </DatePicker>

            <span className={cn(chipClass, 'gap-1.5 pr-1.5')} title="Time estimate">
              <Clock size={13} />
              <DurationPartsInputs
                valueSeconds={estimateSeconds}
                onChange={setEstimateSeconds}
                inputClassName="w-8 bg-transparent text-center text-xs text-fg outline-none placeholder:text-fg-muted"
              />
            </span>
          </div>
        )}

        <div className="flex flex-wrap items-center gap-1.5">
          <Tag size={13} className="text-fg-muted" />
          {labels.map((label) => (
            <span
              key={label}
              className="inline-flex items-center gap-1 rounded-md bg-brand/10 px-2 py-0.5 text-xs font-medium text-brand dark:bg-brand/15"
            >
              {label}
              <button
                type="button"
                aria-label={`Remove label ${label}`}
                onClick={() => setLabels(labels.filter((l) => l !== label))}
                className="rounded p-0.5 hover:bg-brand/20"
              >
                <X size={10} />
              </button>
            </span>
          ))}
          <input
            value={labelDraft}
            onChange={(e) => setLabelDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ',') {
                e.preventDefault()
                commitLabel()
              }
              if (e.key === 'Backspace' && !labelDraft && labels.length) {
                setLabels(labels.slice(0, -1))
              }
            }}
            onBlur={commitLabel}
            placeholder={labels.length ? 'Add label' : 'Add labels'}
            className="min-w-[90px] flex-1 bg-transparent py-1 text-xs text-fg outline-none placeholder:text-fg-muted"
          />
        </div>

        <div className="flex items-center justify-between border-t border-ink-700 pt-3">
          <p className="text-xs text-fg-muted">
            {createGithubIssue ? 'This task will also be created as a GitHub issue.' : ''}
          </p>
          <button type="button" className="btn-primary" disabled={!canSubmit} onClick={submit}>
            {create.isPending ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />}
            {create.isPending ? 'Creating…' : 'Create Task'}
          </button>
        </div>
      </div>
    </Modal>
  )
}
