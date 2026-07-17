import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Calendar, ChevronDown, Flag, Loader2, UserPlus, X } from 'lucide-react'

import { CreateAssigneePicker, DatePicker, PriorityPicker } from '../../../../components/tasks/pickers'
import { AvatarStack } from '../../../../components/ui/Avatar'
import { api, errorMessage } from '../../../../lib/api'
import { useCurrentContext, useProjects } from '../../../../lib/queries'
import type { OrgMember, Priority, Task } from '../../../../lib/types'
import { cn, formatDate, PRIORITY_COLORS, PRIORITY_LABELS } from '../../../../lib/utils'
import { toast } from '../../../../stores/toast'
import { addDocumentLinkApi } from '../../services/docsApi.service'

export interface CreateTaskBarPosition {
  selectionTop: number
  selectionBottom: number
  selectionCenterX: number
  selectionWidth: number
}

interface DocCreateTaskBarProps {
  documentId: string
  initialTitle: string
  position: CreateTaskBarPosition
  onCreated: (task: Task) => void
  onClose: () => void
}

const VIEW_PAD = 12
const BAR_MIN_W = 420
const BAR_MAX_W = 560

const iconBtn =
  'flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-ink-600 bg-ink-800 text-fg-muted transition-colors hover:border-ink-500 hover:text-fg'

/**
 * Floating composer for turning selected doc text into a project task.
 * Portaled + viewport-clamped so it never clips or overflows unevenly.
 */
export function DocCreateTaskBar({
  documentId,
  initialTitle,
  position,
  onCreated,
  onClose,
}: DocCreateTaskBarProps) {
  const rootRef = useRef<HTMLDivElement>(null)
  const { workspace } = useCurrentContext()
  const projects = useProjects(workspace?.id)
  const [projectId, setProjectId] = useState('')
  const [title, setTitle] = useState(initialTitle)
  const [assigneeIds, setAssigneeIds] = useState<string[]>([])
  const [priority, setPriority] = useState<Priority | null>(null)
  const [dueDate, setDueDate] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [members, setMembers] = useState<OrgMember[]>([])
  const initialWidth = Math.min(BAR_MAX_W, Math.max(BAR_MIN_W, typeof window !== 'undefined' ? window.innerWidth - VIEW_PAD * 2 : BAR_MIN_W))
  const [box, setBox] = useState(() => {
    const width = initialWidth
    const left = Math.min(
      Math.max(VIEW_PAD, position.selectionCenterX - width / 2),
      (typeof window !== 'undefined' ? window.innerWidth : width) - width - VIEW_PAD,
    )
    return {
      top: Math.min(position.selectionBottom + 8, (typeof window !== 'undefined' ? window.innerHeight : 800) - 64),
      left,
      width,
    }
  })

  useEffect(() => {
    setTitle(initialTitle)
  }, [initialTitle])

  useEffect(() => {
    if (!projectId && projects.data?.[0]?.id) setProjectId(projects.data[0].id)
  }, [projectId, projects.data])

  useEffect(() => {
    if (!projectId) {
      setMembers([])
      return
    }
    let cancelled = false
    void api
      .get<OrgMember[]>(`/projects/${projectId}/members`)
      .then((rows) => {
        if (!cancelled) setMembers(rows)
      })
      .catch(() => {
        if (!cancelled) setMembers([])
      })
    return () => {
      cancelled = true
    }
  }, [projectId])

  useEffect(() => {
    if (!members.length) return
    const allowed = new Set(members.map((m) => m.user_id))
    setAssigneeIds((ids) => ids.filter((id) => allowed.has(id)))
  }, [members])

  const place = () => {
    const width = Math.min(BAR_MAX_W, Math.max(BAR_MIN_W, window.innerWidth - VIEW_PAD * 2))
    const height = rootRef.current?.offsetHeight ?? 56
    const spaceBelow = window.innerHeight - position.selectionBottom - VIEW_PAD
    const spaceAbove = position.selectionTop - VIEW_PAD
    // Prefer below selection; flip above when the bar + pickers would be crushed.
    const placeAbove = spaceBelow < height + 280 && spaceAbove > spaceBelow
    const top = placeAbove
      ? Math.max(VIEW_PAD, position.selectionTop - height - 8)
      : Math.min(position.selectionBottom + 8, window.innerHeight - height - VIEW_PAD)
    const left = Math.min(
      Math.max(VIEW_PAD, position.selectionCenterX - width / 2),
      window.innerWidth - width - VIEW_PAD,
    )
    setBox({ top, left, width })
  }

  useLayoutEffect(() => {
    place()
  }, [position.selectionTop, position.selectionBottom, position.selectionCenterX])

  useEffect(() => {
    const onResize = () => place()
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [position.selectionTop, position.selectionBottom, position.selectionCenterX])

  const projectLabel = useMemo(() => {
    const p = projects.data?.find((x) => x.id === projectId)
    return p?.name ?? 'Select project…'
  }, [projectId, projects.data])

  const selectedUsers = useMemo(
    () =>
      members
        .filter((m) => assigneeIds.includes(m.user_id))
        .map((m) => ({
          id: m.user_id,
          full_name: m.user?.full_name || m.user?.email || 'Member',
          avatar_url: m.user?.avatar_url ?? null,
        })),
    [members, assigneeIds],
  )

  const create = async () => {
    const trimmed = title.trim()
    if (!projectId || !trimmed || busy) return
    setBusy(true)
    try {
      const task = await api.post<Task>(`/projects/${projectId}/tasks`, {
        title: trimmed,
        ...(assigneeIds.length ? { assignee_ids: assigneeIds } : {}),
        ...(priority ? { priority } : {}),
        ...(dueDate ? { due_date: dueDate } : {}),
      })
      try {
        await addDocumentLinkApi(documentId, 'task', task.id)
      } catch {
        /* best-effort link */
      }
      toast.success(`${task.ref} created`)
      onCreated(task)
      onClose()
    } catch (err) {
      toast.error(errorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  return createPortal(
    <div
      ref={rootRef}
      role="dialog"
      aria-label="Create task from selection"
      style={{ position: 'fixed', top: box.top, left: box.left, width: box.width }}
      className="z-[70] rounded-xl border border-ink-700 bg-ink-850 p-2.5 shadow-popover"
      onMouseDown={(e) => e.stopPropagation()}
    >
      <div className="flex min-w-0 items-center gap-2">
        <label className="relative shrink-0">
          <span className="sr-only">Project</span>
          <span className="flex h-8 max-w-[9.5rem] items-center gap-1 rounded-lg border border-ink-700 bg-ink-800 px-2 text-xs text-fg-secondary">
            <span className="truncate">
              <span className="text-fg-muted">in </span>
              {projectLabel}
            </span>
            <ChevronDown size={12} className="shrink-0 opacity-70" />
          </span>
          <select
            value={projectId}
            onChange={(e) => {
              setProjectId(e.target.value)
              setAssigneeIds([])
            }}
            className="absolute inset-0 cursor-pointer opacity-0"
            aria-label="Select project"
          >
            {(projects.data ?? []).map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </label>

        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault()
              void create()
            }
            if (e.key === 'Escape') onClose()
          }}
          className="h-8 min-w-0 flex-1 rounded-lg border border-ink-700/60 bg-ink-900/40 px-2.5 text-sm text-fg outline-none focus:border-brand"
          placeholder="Task title"
          autoFocus
        />

        <div className="flex shrink-0 items-center gap-1">
          {projectId ? (
            <CreateAssigneePicker
              projectId={projectId}
              value={assigneeIds}
              onChange={setAssigneeIds}
              menuAlign="right"
              preferUp
            >
              <button
                type="button"
                title="Assignees"
                className={cn(iconBtn, assigneeIds.length > 0 && 'border-brand/50 text-fg')}
              >
                {selectedUsers.length > 0 ? (
                  <AvatarStack users={selectedUsers} size={18} max={2} />
                ) : (
                  <UserPlus size={14} />
                )}
              </button>
            </CreateAssigneePicker>
          ) : (
            <button type="button" disabled title="Select a project first" className={cn(iconBtn, 'opacity-40')}>
              <UserPlus size={14} />
            </button>
          )}

          <PriorityPicker value={priority} onChange={setPriority} menuAlign="right" preferUp>
            <button
              type="button"
              title="Priority"
              className={cn(iconBtn, priority && 'border-brand/50 text-fg')}
            >
              <Flag
                size={14}
                style={priority ? { color: PRIORITY_COLORS[priority] } : undefined}
                fill={priority ? PRIORITY_COLORS[priority] : 'none'}
              />
            </button>
          </PriorityPicker>

          <DatePicker
            value={dueDate}
            onChange={setDueDate}
            clearLabel="Clear due"
            closeOnSelect
            preferUp
          >
            <button
              type="button"
              title={dueDate ? `Due ${formatDate(dueDate)}` : 'Due date'}
              className={cn(iconBtn, dueDate && 'border-brand/50 text-fg')}
            >
              <Calendar size={14} />
            </button>
          </DatePicker>
        </div>

        <button
          type="button"
          disabled={!projectId || !title.trim() || busy}
          onClick={() => void create()}
          className="btn-primary h-8 shrink-0 px-3.5 text-xs disabled:opacity-50"
        >
          {busy ? <Loader2 size={14} className="animate-spin" /> : 'Create'}
        </button>

        <button
          type="button"
          title="Close"
          onClick={onClose}
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-fg-muted hover:bg-ink-750 hover:text-fg"
        >
          <X size={14} />
        </button>
      </div>

      {(assigneeIds.length > 0 || priority || dueDate) && (
        <div className="mt-2 flex flex-wrap items-center gap-2 border-t border-ink-700 pt-2 text-[11px] text-fg-muted">
          {assigneeIds.length > 0 && (
            <span className="rounded-md bg-ink-800 px-1.5 py-0.5">
              {assigneeIds.length} assignee{assigneeIds.length === 1 ? '' : 's'}
            </span>
          )}
          {priority && (
            <span className="rounded-md bg-ink-800 px-1.5 py-0.5" style={{ color: PRIORITY_COLORS[priority] }}>
              {PRIORITY_LABELS[priority]}
            </span>
          )}
          {dueDate && (
            <span className="rounded-md bg-ink-800 px-1.5 py-0.5">Due {formatDate(dueDate)}</span>
          )}
        </div>
      )}
    </div>,
    document.body,
  )
}
