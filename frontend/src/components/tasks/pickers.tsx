import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Calendar, Check, ChevronDown, Flag, Search, X } from 'lucide-react'
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'

import { api, errorMessage } from '../../lib/api'
import { invalidateTaskCaches, patchTaskInCaches, restoreTaskCaches, snapshotTaskCaches } from '../../lib/taskCache'
import { useCurrentContext, useProject, useStatuses } from '../../lib/queries'
import type { CustomStatus, Priority, Task } from '../../lib/types'
import { cn, formatDate, isOverdue, PRIORITY_COLORS, PRIORITY_LABELS, todayDateKey, toDateInputValue } from '../../lib/utils'
import { useAuthStore } from '../../stores/auth'
import { toast } from '../../stores/toast'
import { Avatar, AvatarStack } from '../ui/Avatar'
import { StatusIcon } from '../ui/badges'
import { Dropdown } from '../ui/Dropdown'
import { InlineCalendar } from '../ui/InlineCalendar'
import type { OrgMember } from '../../lib/types'

function sortStatuses(statuses: CustomStatus[]): CustomStatus[] {
  return [...statuses].sort((a, b) => a.position - b.position)
}

/** Statuses used for click-to-cycle (excludes cancelled). */
function cycleStatuses(statuses: CustomStatus[]): CustomStatus[] {
  return sortStatuses(statuses).filter((s) => s.category !== 'cancelled')
}

function getNextStatus(statuses: CustomStatus[], current: CustomStatus | null): CustomStatus | null {
  const ordered = cycleStatuses(statuses)
  if (ordered.length === 0) return null
  const idx = current ? ordered.findIndex((s) => s.id === current.id) : -1
  const nextIdx = idx < 0 ? 0 : idx + 1
  if (nextIdx >= ordered.length) return null
  return ordered[nextIdx] ?? null
}

export function StatusPicker({
  projectId,
  value,
  onChange,
  variant = 'pill',
  size = 'sm',
}: {
  projectId: string
  value: CustomStatus | null
  onChange: (statusId: string, status: CustomStatus) => void
  variant?: 'pill' | 'icon'
  size?: 'sm' | 'md'
}) {
  const statuses = useStatuses(projectId)
  const list = sortStatuses(statuses.data ?? [])
  const color = value?.color ?? '#87909E'

  const cycle = (e: React.MouseEvent) => {
    e.stopPropagation()
    const next = getNextStatus(list, value)
    if (next) onChange(next.id, next)
  }

  const menu = (close: () => void) =>
    list.map((status) => (
      <button
        key={status.id}
        className="menu-item"
        onClick={(e) => {
          e.stopPropagation()
          onChange(status.id, status)
          close()
        }}
      >
        <StatusIcon category={status.category} color={status.color} size={14} />
        <span className="flex-1">{status.name}</span>
        {value?.id === status.id && <Check size={14} className="text-brand" />}
      </button>
    ))

  if (variant === 'icon') {
    return (
      <div className="mr-1 inline-flex h-5 shrink-0 items-center gap-0.5" onClick={(e) => e.stopPropagation()}>
        <button
          type="button"
          className="flex h-5 w-5 items-center justify-center rounded-md transition-transform hover:scale-110"
          title={value?.name ?? 'Set status'}
          onClick={cycle}
        >
          <StatusIcon category={value?.category} color={color} size={14} />
        </button>
        <Dropdown
          width="w-48"
          align="left"
          className="inline-flex h-5 items-center"
          trigger={
            <button
              type="button"
              className="flex h-5 w-4 items-center justify-center rounded-md text-fg-muted transition-colors hover:bg-ink-750 hover:text-fg"
              title="All statuses"
            >
              <ChevronDown size={11} />
            </button>
          }
        >
          {menu}
        </Dropdown>
      </div>
    )
  }

  const pillSize = size === 'sm' ? 'px-2 py-0.5 text-[10px]' : 'px-2.5 py-1 text-xs'
  const iconSize = size === 'sm' ? 12 : 14
  const chevronSize = size === 'sm' ? 12 : 14

  return (
    <div
      className="inline-flex max-w-full items-center overflow-hidden rounded-md border"
      style={{ borderColor: `${color}55`, backgroundColor: `${color}14` }}
      onClick={(e) => e.stopPropagation()}
    >
      <button
        type="button"
        className={cn(
          'inline-flex min-w-0 items-center gap-1.5 font-semibold uppercase tracking-wide transition-colors hover:brightness-110',
          pillSize,
          size === 'sm' ? 'pr-0.5' : 'pr-1',
        )}
        style={{ color }}
        title={value?.name ?? 'Set status'}
        onClick={cycle}
      >
        {value ? (
          <>
            <StatusIcon category={value.category} color={color} size={iconSize} />
            <span className="truncate">{value.name}</span>
          </>
        ) : (
          <span className="normal-case text-fg-muted">No status</span>
        )}
      </button>
      <Dropdown
        width="w-48"
        align="left"
        className="inline-flex items-center"
        trigger={
          <button
            type="button"
            className={cn(
              'flex items-center justify-center transition-colors hover:brightness-110',
              size === 'sm' ? 'px-1 py-0.5' : 'px-1.5 py-1',
            )}
            style={{ color }}
            title="All statuses"
          >
            <ChevronDown size={chevronSize} />
          </button>
        }
      >
        {menu}
      </Dropdown>
    </div>
  )
}

export function PriorityPicker({
  value,
  onChange,
  children,
  menuAlign = 'left',
  preferUp = false,
}: {
  value: Priority | null
  onChange: (p: Priority | null) => void
  children: React.ReactNode
  menuAlign?: 'left' | 'right'
  preferUp?: boolean
}) {
  const options: Priority[] = ['urgent', 'high', 'normal', 'low']
  return (
    <Dropdown trigger={children} width="w-40" align={menuAlign} preferUp={preferUp}>
      {(close) => (
        <>
          {options.map((p) => (
            <button
              key={p}
              className="menu-item"
              onClick={() => {
                onChange(p)
                close()
              }}
            >
              <Flag size={13} style={{ color: PRIORITY_COLORS[p] }} fill={PRIORITY_COLORS[p]} />
              <span className="flex-1">{PRIORITY_LABELS[p]}</span>
              {value === p && <Check size={14} className="text-brand" />}
            </button>
          ))}
          <div className="my-1 h-px bg-ink-700" />
          <button
            className="menu-item"
            onClick={() => {
              onChange(null)
              close()
            }}
          >
            <X size={13} className="text-fg-muted" />
            <span>Clear</span>
          </button>
        </>
      )}
    </Dropdown>
  )
}

const DATE_PANEL_WIDTH = 256
const PANEL_MARGIN = 12
const PANEL_GAP = 6
/** Keep opening downward unless less than this remains below the trigger. */
const MIN_DOWN_SPACE = 160

interface PanelPosition {
  top: number
  left: number
  maxHeight: number
}

function flushFocusedInput(panel: HTMLElement | null) {
  const active = document.activeElement
  if (active instanceof HTMLElement && panel?.contains(active)) {
    active.blur()
  }
}

function useFloatingPanel(
  open: boolean,
  triggerRef: React.RefObject<HTMLElement | null>,
  panelRef: React.RefObject<HTMLElement | null>,
  onClose: () => void,
  preferUp = false,
) {
  const [position, setPosition] = useState<PanelPosition>({ top: 0, left: 0, maxHeight: 400 })
  const anchorRectRef = useRef<DOMRect | null>(null)
  // Bumped on every openPanel() call so the measuring effect re-runs even when
  // the panel is already open (e.g. switching the Start/Due anchor).
  const [anchorVersion, setAnchorVersion] = useState(0)

  const openPanel = (anchor?: HTMLElement | null) => {
    const rect = (anchor ?? triggerRef.current)?.getBoundingClientRect()
    if (!rect) return
    anchorRectRef.current = rect
    setAnchorVersion((v) => v + 1)
  }

  // Prefer opening below the trigger. Flip upward when preferred or when below is tight
  // and above is better. Cap height so the panel scrolls instead of drifting away.
  useLayoutEffect(() => {
    if (!open) return
    const panel = panelRef.current
    const rect = anchorRectRef.current
    if (!panel || !rect) return
    const naturalHeight = panel.scrollHeight || panel.offsetHeight
    const width = panel.offsetWidth || DATE_PANEL_WIDTH
    const spaceBelow = window.innerHeight - rect.bottom - PANEL_GAP - PANEL_MARGIN
    const spaceAbove = rect.top - PANEL_GAP - PANEL_MARGIN
    const openUp =
      (preferUp && spaceAbove >= 180) ||
      (spaceBelow < MIN_DOWN_SPACE && spaceAbove > spaceBelow + 24)
    const maxHeight = Math.max(180, openUp ? spaceAbove : spaceBelow)
    const height = Math.min(naturalHeight, maxHeight)
    // Stay near the trigger, but keep the whole panel inside the viewport.
    let top = openUp ? rect.top - PANEL_GAP - height : rect.bottom + PANEL_GAP
    top = Math.min(Math.max(PANEL_MARGIN, top), window.innerHeight - Math.min(height, maxHeight) - PANEL_MARGIN)
    const left = Math.min(Math.max(PANEL_MARGIN, rect.left), window.innerWidth - width - PANEL_MARGIN)
    setPosition((prev) =>
      prev.top === top && prev.left === left && prev.maxHeight === maxHeight
        ? prev
        : { top, left, maxHeight },
    )
  }, [open, anchorVersion, panelRef, preferUp])

  useEffect(() => {
    if (!open) return
    const closeAfterFlush = () => {
      flushFocusedInput(panelRef.current)
      onClose()
    }
    const onPointerDown = (e: MouseEvent) => {
      const target = e.target as Node
      if (triggerRef.current?.contains(target) || panelRef.current?.contains(target)) return
      closeAfterFlush()
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closeAfterFlush()
    }
    const onScroll = (e: Event) => {
      if (panelRef.current?.contains(e.target as Node)) return
      closeAfterFlush()
    }
    // Ignore resize events caused by focusing the date input (mobile keyboards /
    // visualViewport changes) — those were discarding typed dates before blur.
    const onResize = () => {
      if (panelRef.current?.contains(document.activeElement)) return
      closeAfterFlush()
    }
    document.addEventListener('mousedown', onPointerDown)
    document.addEventListener('keydown', onKey)
    window.addEventListener('scroll', onScroll, true)
    window.addEventListener('resize', onResize)
    return () => {
      document.removeEventListener('mousedown', onPointerDown)
      document.removeEventListener('keydown', onKey)
      window.removeEventListener('scroll', onScroll, true)
      window.removeEventListener('resize', onResize)
    }
  }, [open, onClose, panelRef, triggerRef])

  return { position, openPanel }
}

export function DatePicker({
  value,
  onChange,
  children,
  clearLabel = 'Clear date',
  closeOnSelect = true,
  min = null,
  max = '2100-12-31',
  preferUp = false,
}: {
  value: string | null
  onChange: (date: string | null) => void
  children: React.ReactNode
  clearLabel?: string
  /** When false, date clicks update a draft until Apply is pressed (for inline create). */
  closeOnSelect?: boolean
  /** Earliest selectable date; null allows any past date. */
  min?: string | null
  max?: string
  preferUp?: boolean
}) {
  const [open, setOpen] = useState(false)
  const [draft, setDraft] = useState<string | null>(null)
  const triggerRef = useRef<HTMLSpanElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)

  const close = () => setOpen(false)
  const { position, openPanel } = useFloatingPanel(open, triggerRef, panelRef, close, preferUp)

  const toggle = () => {
    if (open) {
      close()
      return
    }
    setDraft(toDateInputValue(value) || null)
    openPanel()
    setOpen(true)
  }

  const apply = (next: string | null) => {
    if (next && min && next < min) {
      toast.error(min === todayDateKey() ? 'Date cannot be in the past' : 'Date is before the earliest allowed date')
      return
    }
    onChange(next)
    close()
  }

  const handleSelect = (dateKey: string) => {
    if (closeOnSelect) {
      apply(dateKey)
      return
    }
    setDraft(dateKey)
  }

  const handleClear = () => {
    if (closeOnSelect) {
      apply(null)
      return
    }
    setDraft(null)
  }

  const calendarValue = closeOnSelect ? toDateInputValue(value) || null : draft

  return (
    <>
      <span
        ref={triggerRef}
        className="inline-flex"
        onClick={(e) => {
          e.stopPropagation()
          toggle()
        }}
      >
        {children}
      </span>
      {open &&
        createPortal(
          <div
            ref={panelRef}
            className="menu-panel fixed z-[90] overflow-y-auto p-3"
            style={{ top: position.top, left: position.left, width: DATE_PANEL_WIDTH, maxHeight: position.maxHeight }}
            onClick={(e) => e.stopPropagation()}
            onMouseDown={(e) => e.stopPropagation()}
          >
            <InlineCalendar
              value={calendarValue}
              min={min ?? undefined}
              max={max}
              clearLabel={clearLabel}
              onSelect={handleSelect}
              onClear={handleClear}
            />
            {!closeOnSelect && (
              <div className="mt-2 flex gap-2 border-t border-ink-700 pt-2">
                <button type="button" className="btn-ghost flex-1 text-xs" onClick={close}>
                  Cancel
                </button>
                <button
                  type="button"
                  className="btn-primary flex-1 text-xs"
                  onClick={() => apply(draft)}
                >
                  Apply
                </button>
              </div>
            )}
          </div>,
          document.body,
        )}
    </>
  )
}

/** Combined start + due date editor for the task detail page. */
export function TaskDatesPicker({
  startDate,
  dueDate,
  completedAt,
  onSave,
}: {
  startDate: string | null
  dueDate: string | null
  completedAt: string | null
  onSave: (body: Record<string, unknown>, apply: (t: Task) => Task) => void
}) {
  const [open, setOpen] = useState(false)
  const [activeField, setActiveField] = useState<'start' | 'due'>('start')
  const [displayStart, setDisplayStart] = useState(startDate)
  const [displayDue, setDisplayDue] = useState(dueDate)
  const startBtnRef = useRef<HTMLButtonElement>(null)
  const dueBtnRef = useRef<HTMLButtonElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLSpanElement>(null)
  const overdue = isOverdue(displayDue, completedAt)

  useEffect(() => {
    setDisplayStart(startDate)
    setDisplayDue(dueDate)
  }, [startDate, dueDate])

  const close = () => setOpen(false)
  const { position, openPanel } = useFloatingPanel(open, triggerRef, panelRef, close)

  const openFieldPanel = (field: 'start' | 'due', trigger: HTMLElement) => {
    setActiveField(field)
    openPanel(trigger)
    setOpen(true)
  }

  const switchToField = (field: 'start' | 'due') => {
    const trigger = field === 'start' ? startBtnRef.current : dueBtnRef.current
    if (!trigger) return
    setActiveField(field)
    openPanel(trigger)
  }

  const saveField = (field: 'start' | 'due', next: string | null) => {
    const nextStart = field === 'start' ? next : displayStart
    const nextDue = field === 'due' ? next : displayDue

    if (nextStart && nextDue && nextDue < nextStart) {
      toast.error('Due date must be on or after the start date')
      return
    }

    setDisplayStart(nextStart)
    setDisplayDue(nextDue)

    const body: Record<string, unknown> =
      field === 'start'
        ? next
          ? { start_date: next }
          : { clear_start_date: true }
        : next
          ? { due_date: next }
          : { clear_due_date: true }

    onSave(body, (t) => ({
      ...t,
      start_date: nextStart,
      due_date: nextDue,
    }))

    if (field === 'start' && next !== null) {
      switchToField('due')
      return
    }

    close()
  }

  const triggerClass =
    'cursor-pointer rounded px-1.5 py-0.5 transition-colors hover:bg-ink-750'

  const activeValue = activeField === 'start' ? displayStart : displayDue
  const dueMin = displayStart ? toDateInputValue(displayStart) || undefined : undefined

  return (
    <>
      <span ref={triggerRef} className="inline-flex items-center gap-1.5 text-sm">
        <Calendar size={14} className="shrink-0 text-fg-muted" />
        <button
          ref={startBtnRef}
          type="button"
          className={cn(triggerClass, displayStart ? 'text-fg-secondary' : 'text-fg-muted')}
          onClick={(e) => {
            e.stopPropagation()
            if (open && activeField === 'start') {
              close()
              return
            }
            openFieldPanel('start', e.currentTarget)
          }}
        >
          {displayStart ? formatDate(displayStart) : 'Start'}
        </button>
        <span className="text-fg-muted">→</span>
        <button
          ref={dueBtnRef}
          type="button"
          className={cn(
            triggerClass,
            displayDue ? (overdue ? 'font-medium text-red-400' : 'text-fg-secondary') : 'text-fg-muted',
          )}
          onClick={(e) => {
            e.stopPropagation()
            if (open && activeField === 'due') {
              close()
              return
            }
            openFieldPanel('due', e.currentTarget)
          }}
        >
          {displayDue ? formatDate(displayDue) : 'Due'}
        </button>
      </span>
      {open &&
        createPortal(
          <div
            ref={panelRef}
            className="menu-panel fixed z-[90] overflow-y-auto p-3"
            style={{ top: position.top, left: position.left, width: DATE_PANEL_WIDTH, maxHeight: position.maxHeight }}
            onClick={(e) => e.stopPropagation()}
            onMouseDown={(e) => e.stopPropagation()}
          >
            <div className="mb-2 grid grid-cols-2 gap-1 rounded-lg bg-ink-800/80 p-1">
              {(['start', 'due'] as const).map((field) => (
                <button
                  key={field}
                  type="button"
                  aria-pressed={activeField === field}
                  className={cn(
                    'rounded-md px-2 py-1 text-[11px] font-semibold uppercase tracking-wide transition-colors',
                    activeField === field
                      ? 'bg-ink-700 text-fg shadow-sm'
                      : 'text-fg-muted hover:text-fg-secondary',
                  )}
                  onClick={() => switchToField(field)}
                >
                  {field === 'start' ? 'Start' : 'Due'}
                </button>
              ))}
            </div>
            <InlineCalendar
              value={toDateInputValue(activeValue) || null}
              min={activeField === 'due' ? dueMin : undefined}
              max="2100-12-31"
              clearLabel={activeField === 'start' ? 'Clear start' : 'Clear due'}
              onSelect={(dateKey) => saveField(activeField, dateKey)}
              onClear={() => saveField(activeField, null)}
            />
          </div>,
          document.body,
        )}
    </>
  )
}

function memberMatchesQuery(member: OrgMember, query: string) {
  if (!query) return true
  const hay = `${member.user?.full_name ?? ''} ${member.user?.email ?? ''}`.toLowerCase()
  return hay.includes(query)
}

function AssigneeMenuList({
  members,
  loading,
  assignedIds,
  canManage,
  currentUserId,
  onToggle,
}: {
  members: OrgMember[]
  loading?: boolean
  assignedIds: Set<string>
  canManage: boolean
  currentUserId?: string | null
  onToggle: (userId: string) => void
}) {
  const [query, setQuery] = useState('')
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    const list = members.filter((m) => memberMatchesQuery(m, q))
    // Keep current user near the top when unfiltered.
    if (!q || !currentUserId) return list
    return list
  }, [members, query, currentUserId])

  const sorted = useMemo(() => {
    if (!currentUserId || query.trim()) return filtered
    return [...filtered].sort((a, b) => {
      if (a.user_id === currentUserId) return -1
      if (b.user_id === currentUserId) return 1
      return 0
    })
  }, [filtered, currentUserId, query])

  return (
    <>
      <div className="border-b border-ink-700 px-2 py-2" onClick={(e) => e.stopPropagation()}>
        <label className="flex items-center gap-2 rounded-md border border-ink-600 bg-ink-850 px-2 py-1.5 focus-within:border-brand">
          <Search size={13} className="shrink-0 text-fg-muted" />
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search or enter email..."
            className="min-w-0 flex-1 bg-transparent text-xs text-fg outline-none placeholder:text-fg-muted"
            autoFocus
          />
        </label>
      </div>
      <p className="px-3 pb-1 pt-2 text-[11px] font-semibold uppercase tracking-wider text-fg-muted">
        People
      </p>
      <div className="max-h-56 overflow-y-auto py-0.5">
        {sorted.map((member) => {
          const isMe = member.user_id === currentUserId
          const label = isMe ? 'Me' : member.user?.full_name || member.user?.email || '?'
          const assigned = assignedIds.has(member.user_id)
          return (
            <button
              key={member.user_id}
              type="button"
              className={cn('menu-item', !canManage && 'cursor-default opacity-80 hover:bg-transparent')}
              disabled={!canManage}
              onClick={(e) => {
                e.stopPropagation()
                onToggle(member.user_id)
              }}
              title={canManage ? undefined : 'Only project or workspace admins can change assignees'}
            >
              <Avatar
                name={member.user?.full_name || member.user?.email || '?'}
                src={member.user?.avatar_url}
                size={22}
                userId={member.user_id}
                showPresence
              />
              <span className="flex-1 truncate text-left" title={member.user?.full_name || member.user?.email || undefined}>
                {label}
              </span>
              <span
                className={cn(
                  'flex h-4 w-4 items-center justify-center rounded border',
                  assigned ? 'border-brand bg-brand text-white' : 'border-ink-600',
                  !canManage && 'opacity-50',
                )}
              >
                {assigned && <Check size={11} />}
              </span>
            </button>
          )
        })}
        {loading && <p className="px-3 py-3 text-xs text-fg-muted">Loading members…</p>}
        {!loading && members.length === 0 && (
          <p className="px-3 py-3 text-xs text-fg-muted">No project members</p>
        )}
        {!loading && members.length > 0 && sorted.length === 0 && (
          <p className="px-3 py-3 text-xs text-fg-muted">No matches</p>
        )}
      </div>
      {!canManage && members.length > 0 && (
        <p className="border-t border-ink-700 px-3 py-2 text-[11px] text-fg-muted">
          Only admins can change assignees.
        </p>
      )}
      {canManage && (
        <p className="border-t border-ink-700 px-3 py-2 text-[11px] text-fg-muted">
          Select multiple people to co-assign this task.
        </p>
      )}
    </>
  )
}

/** Create-time assignee multi-select: local state only, the ids ride along on
 * the task create payload (no per-assignee API writes). */
export function CreateAssigneePicker({
  projectId,
  value,
  onChange,
  children,
  menuAlign = 'left',
  preferUp = false,
}: {
  projectId: string
  value: string[]
  onChange: (ids: string[]) => void
  children: React.ReactNode
  menuAlign?: 'left' | 'right'
  preferUp?: boolean
}) {
  const me = useAuthStore((s) => s.user)
  const members = useQuery({
    queryKey: ['project-members', projectId],
    queryFn: () => api.get<OrgMember[]>(`/projects/${projectId}/members`),
    enabled: !!projectId,
  })
  const selected = new Set(value)

  const toggle = (userId: string) => {
    const next = new Set(selected)
    if (next.has(userId)) next.delete(userId)
    else next.add(userId)
    onChange([...next])
  }

  return (
    <Dropdown trigger={children} width="w-64" align={menuAlign} preferUp={preferUp}>
      {() => (
        <AssigneeMenuList
          members={members.data ?? []}
          loading={members.isLoading}
          assignedIds={selected}
          canManage
          currentUserId={me?.id}
          onToggle={toggle}
        />
      )}
    </Dropdown>
  )
}

/** Picks assignees from project members; assigns/unassigns via API.
 * Children are the empty-state trigger (e.g. dashed UserPlus). When the task
 * already has assignees, avatars are shown with a hover "x" to unassign. */
export function AssigneePicker({
  task,
  children,
  size = 24,
  max = 4,
}: {
  task: Task
  children: React.ReactNode
  size?: number
  max?: number
}) {
  const queryClient = useQueryClient()
  const me = useAuthStore((s) => s.user)
  const { org, workspace } = useCurrentContext()
  const project = useProject(task.project_id)
  const members = useQuery({
    queryKey: ['project-members', task.project_id],
    queryFn: () => api.get<OrgMember[]>(`/projects/${task.project_id}/members`),
  })
  const canManageAssignees =
    (org?.my_role === 'owner' || org?.my_role === 'admin') ||
    project.data?.my_role === 'admin' ||
    (workspace?.id === project.data?.workspace_id && (workspace?.my_role === 'admin' || workspace?.my_role === 'owner'))

  const [assignedIds, setAssignedIds] = useState<Set<string>>(
    () => new Set(task.assignees.map((a) => a.id)),
  )

  useEffect(() => {
    setAssignedIds(new Set(task.assignees.map((a) => a.id)))
  }, [task.id, task.assignees])

  const toggle = async (userId: string) => {
    if (!canManageAssignees) return
    const wasAssigned = assignedIds.has(userId)
    setAssignedIds((current) => {
      const next = new Set(current)
      if (wasAssigned) next.delete(userId)
      else next.add(userId)
      return next
    })
    // Optimistically update the task's assignee avatars everywhere it's shown.
    const member = members.data?.find((m) => m.user_id === userId)?.user
    const snapshot = snapshotTaskCaches(queryClient)
    patchTaskInCaches(queryClient, task.id, (t) => ({
      ...t,
      assignees: wasAssigned
        ? t.assignees.filter((a) => a.id !== userId)
        : member && !t.assignees.some((a) => a.id === userId)
          ? [...t.assignees, member]
          : t.assignees,
    }))
    try {
      if (wasAssigned) {
        await api.delete(`/tasks/${task.id}/assignees/${userId}`)
      } else {
        await api.post(`/tasks/${task.id}/assignees`, { user_ids: [userId] })
      }
      invalidateTaskCaches(queryClient, task.id)
      if (task.parent_task_id) {
        void queryClient.invalidateQueries({ queryKey: ['task', task.parent_task_id] })
      }
    } catch (err) {
      restoreTaskCaches(queryClient, snapshot)
      setAssignedIds((current) => {
        const next = new Set(current)
        if (wasAssigned) next.add(userId)
        else next.delete(userId)
        return next
      })
      toast.error(errorMessage(err))
    }
  }

  const trigger =
    task.assignees.length > 0 ? (
      <span className="inline-flex cursor-pointer items-center">
        <AvatarStack
          users={task.assignees}
          size={size}
          max={max}
          onRemove={canManageAssignees ? (userId) => void toggle(userId) : undefined}
        />
      </span>
    ) : (
      children
    )

  return (
    <Dropdown trigger={trigger} width="w-64">
      {() => (
        <AssigneeMenuList
          members={members.data ?? []}
          loading={members.isLoading}
          assignedIds={assignedIds}
          canManage={canManageAssignees}
          currentUserId={me?.id}
          onToggle={(userId) => void toggle(userId)}
        />
      )}
    </Dropdown>
  )
}
