import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ChevronLeft, ChevronRight, ClipboardList, Plus, Timer } from 'lucide-react'
import { useMemo, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'

import { api, errorMessage } from '../../lib/api'
import { useCurrentContext, useProjects } from '../../lib/queries'
import type { Page, Task, TimeEntry } from '../../lib/types'
import { addDays, cn, formatDate, formatDuration, startOfWeek, toDateKey } from '../../lib/utils'
import { toast } from '../../stores/toast'
import { Modal } from '../../components/ui/Modal'
import { CenteredSpinner } from '../../components/ui/Spinner'

const DAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

export default function TimesheetPage() {
  const [params, setParams] = useSearchParams()
  const tab = params.get('tab') === 'entries' ? 'entries' : 'week'
  const createOpen = params.get('new') === '1'
  const [weekAnchor, setWeekAnchor] = useState(() => startOfWeek(new Date()))

  const weekStart = weekAnchor
  const weekEnd = addDays(weekStart, 7)
  const weekLabel = `${weekStart.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })} - ${addDays(weekStart, 6).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}`

  const entries = useQuery({
    queryKey: ['timesheet', toDateKey(weekStart)],
    queryFn: () =>
      api.get<Page<TimeEntry>>(
        `/me/time-entries?start=${weekStart.toISOString()}&end=${weekEnd.toISOString()}&page_size=500`,
      ),
  })

  const closeCreate = () => {
    params.delete('new')
    setParams(params, { replace: true })
  }

  return (
    <div className="mx-auto max-w-6xl px-8 py-6">
      {/* Header */}
      <div className="flex items-center gap-2">
        <Timer size={18} className="text-fg-secondary" />
        <h1 className="text-lg font-bold text-fg">Timesheets</h1>
        <div className="mx-3 h-5 w-px bg-ink-700" />
        <TabButton active={tab === 'week'} onClick={() => { params.delete('tab'); setParams(params, { replace: true }) }}>
          My timesheet
        </TabButton>
        <TabButton active={tab === 'entries'} onClick={() => { params.set('tab', 'entries'); setParams(params, { replace: true }) }}>
          Time entries
        </TabButton>
        <span className="flex-1" />
        <button className="btn-primary !py-1.5 text-xs" onClick={() => { params.set('new', '1'); setParams(params, { replace: true }) }}>
          <Plus size={13} /> Create entry
        </button>
      </div>

      {tab === 'week' && (
        <>
          {/* Week navigation */}
          <div className="mt-5 flex items-center gap-1.5">
            <button className="btn-ghost !px-1.5" onClick={() => setWeekAnchor(addDays(weekAnchor, -7))}>
              <ChevronLeft size={16} />
            </button>
            <button className="btn-ghost !px-1.5" onClick={() => setWeekAnchor(addDays(weekAnchor, 7))}>
              <ChevronRight size={16} />
            </button>
            <h2 className="ml-1 text-base font-bold text-fg">{weekLabel}</h2>
            <button className="btn-ghost ml-2 text-xs" onClick={() => setWeekAnchor(startOfWeek(new Date()))}>
              Today
            </button>
          </div>

          <div className="mt-4">
            {entries.isLoading ? (
              <CenteredSpinner />
            ) : (
              <WeekGrid entries={entries.data?.items ?? []} weekStart={weekStart} onCreate={() => { params.set('new', '1'); setParams(params, { replace: true }) }} />
            )}
          </div>
        </>
      )}

      {tab === 'entries' && <EntriesList />}

      <CreateEntryModal open={createOpen} onClose={closeCreate} onCreated={() => void entries.refetch()} />
    </div>
  )
}

function TabButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={cn(
        'rounded-lg px-3 py-1.5 text-sm font-medium transition-colors',
        active ? 'bg-ink-750 text-fg' : 'text-fg-secondary hover:bg-ink-800 hover:text-fg',
      )}
    >
      {children}
    </button>
  )
}

function WeekGrid({
  entries,
  weekStart,
  onCreate,
}: {
  entries: TimeEntry[]
  weekStart: Date
  onCreate: () => void
}) {
  const navigate = useNavigate()
  const days = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i))
  const todayKey = toDateKey(new Date())

  const { rows, dayTotals, grandTotal } = useMemo(() => {
    const byTask = new Map<string, { ref: string | null; title: string; perDay: number[]; total: number; running: boolean }>()
    const totals = Array(7).fill(0) as number[]
    let grand = 0
    for (const entry of entries) {
      const started = new Date(entry.started_at)
      const dayIndex = Math.floor((started.getTime() - weekStart.getTime()) / 86400000)
      const seconds = entry.duration_seconds ?? Math.floor((Date.now() - started.getTime()) / 1000)
      const row = byTask.get(entry.task_id) ?? {
        ref: entry.task_ref,
        title: entry.task_title ?? 'Task',
        perDay: Array(7).fill(0),
        total: 0,
        running: false,
      }
      if (dayIndex >= 0 && dayIndex < 7) {
        row.perDay[dayIndex] += seconds
        totals[dayIndex] += seconds
      }
      row.total += seconds
      if (!entry.ended_at) row.running = true
      grand += seconds
      byTask.set(entry.task_id, row)
    }
    return { rows: [...byTask.entries()], dayTotals: totals, grandTotal: grand }
  }, [entries, weekStart])

  if (entries.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center rounded-2xl border border-ink-700 bg-ink-850/40 py-16">
        <Timer size={36} className="text-ink-600" />
        <p className="mt-4 text-sm font-semibold text-fg">Add entries to this week's timesheet</p>
        <p className="mt-1 text-xs text-fg-muted">Track time from any task, or log it manually.</p>
        <div className="mt-6 flex gap-3">
          <ActionCard icon={<Plus size={16} />} label="Create entry" onClick={onCreate} />
          <ActionCard icon={<ClipboardList size={16} />} label="My Tasks" onClick={() => navigate('/app/planner')} />
        </div>
      </div>
    )
  }

  return (
    <div className="overflow-hidden rounded-xl border border-ink-700">
      <div
        className="grid items-center border-b border-ink-700 bg-ink-850 text-[11px] font-medium uppercase tracking-wide text-fg-muted"
        style={{ gridTemplateColumns: 'minmax(220px,1.4fr) repeat(7, 1fr) 90px' }}
      >
        <span className="border-r border-ink-700/60 px-3 py-2">Task</span>
        {days.map((day, i) => (
          <span
            key={i}
            className={cn(
              'border-r border-ink-700/60 px-2 py-2 text-center',
              toDateKey(day) === todayKey && 'bg-brand-soft text-brand',
            )}
          >
            {DAY_LABELS[i]} {day.getDate()}
          </span>
        ))}
        <span className="px-2 py-2 text-right">Total</span>
      </div>

      {rows.map(([taskId, row]) => (
        <div
          key={taskId}
          className="grid cursor-pointer items-center border-b border-ink-700/60 bg-ink-900 transition-colors last:border-b-0 hover:bg-ink-850"
          style={{ gridTemplateColumns: 'minmax(220px,1.4fr) repeat(7, 1fr) 90px' }}
          onClick={() => navigate(`/app/tasks/${taskId}`)}
        >
          <span className="flex min-w-0 items-center gap-2 border-r border-ink-700/60 px-3 py-2.5">
            <span className="shrink-0 text-[11px] text-fg-muted">{row.ref}</span>
            <span className="truncate text-sm text-fg">{row.title}</span>
            {row.running && (
              <span className="shrink-0 rounded bg-emerald-500/15 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-400">
                running
              </span>
            )}
          </span>
          {row.perDay.map((seconds, i) => (
            <span key={i} className="border-r border-ink-700/60 px-2 py-2.5 text-center font-mono text-xs text-fg-secondary">
              {seconds > 0 ? formatDuration(seconds) : '—'}
            </span>
          ))}
          <span className="px-2 py-2.5 text-right font-mono text-xs font-semibold text-fg">
            {formatDuration(row.total)}
          </span>
        </div>
      ))}

      {/* Totals row */}
      <div
        className="grid items-center bg-ink-850"
        style={{ gridTemplateColumns: 'minmax(220px,1.4fr) repeat(7, 1fr) 90px' }}
      >
        <span className="border-r border-ink-700/60 px-3 py-2.5 text-xs font-semibold text-fg-secondary">Total</span>
        {dayTotals.map((seconds, i) => (
          <span key={i} className="border-r border-ink-700/60 px-2 py-2.5 text-center font-mono text-xs text-fg-secondary">
            {seconds > 0 ? formatDuration(seconds) : '—'}
          </span>
        ))}
        <span className="px-2 py-2.5 text-right font-mono text-xs font-bold text-brand">{formatDuration(grandTotal)}</span>
      </div>
    </div>
  )
}

function ActionCard({ icon, label, onClick }: { icon: React.ReactNode; label: string; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="flex w-44 flex-col items-start gap-2.5 rounded-xl border border-ink-700 bg-ink-850 px-4 py-3.5 transition-colors hover:border-ink-600"
    >
      <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-ink-800 text-fg-secondary">{icon}</span>
      <span className="text-sm font-medium text-fg">{label}</span>
    </button>
  )
}

function EntriesList() {
  const navigate = useNavigate()
  const { data, isLoading } = useQuery({
    queryKey: ['my-time'],
    queryFn: () => api.get<Page<TimeEntry>>('/me/time-entries?page_size=100'),
  })
  if (isLoading) return <CenteredSpinner />
  const entries = data?.items ?? []
  return (
    <div className="mt-5 overflow-hidden rounded-xl border border-ink-700">
      {entries.map((entry) => (
        <button
          key={entry.id}
          onClick={() => navigate(`/app/tasks/${entry.task_id}`)}
          className="flex w-full items-center gap-3 border-b border-ink-700/60 bg-ink-900 px-4 py-2.5 text-left transition-colors last:border-b-0 hover:bg-ink-850"
        >
          <span className="text-xs text-fg-muted">{entry.task_ref}</span>
          <span className="min-w-0 flex-1 truncate text-sm text-fg">{entry.task_title ?? 'Task'}</span>
          <span className="text-[11px] text-fg-muted">
            {formatDate(entry.started_at)}
            {entry.is_manual ? ' · manual' : ''}
            {entry.stopped_by_system ? ' · auto-stopped' : ''}
          </span>
          <span className="w-20 text-right font-mono text-xs text-fg">
            {entry.duration_seconds != null ? formatDuration(entry.duration_seconds) : 'running'}
          </span>
        </button>
      ))}
      {entries.length === 0 && <p className="bg-ink-900 px-4 py-8 text-center text-sm text-fg-muted">No time entries yet.</p>}
    </div>
  )
}

function CreateEntryModal({ open, onClose, onCreated }: { open: boolean; onClose: () => void; onCreated: () => void }) {
  const { workspace } = useCurrentContext()
  const projects = useProjects(workspace?.id)
  const queryClient = useQueryClient()
  const [projectId, setProjectId] = useState('')
  const [taskId, setTaskId] = useState('')
  const [date, setDate] = useState(() => toDateKey(new Date()))
  const [startTime, setStartTime] = useState('09:00')
  const [hours, setHours] = useState('1')
  const [minutes, setMinutes] = useState('0')
  const [description, setDescription] = useState('')

  const effectiveProject = projectId || projects.data?.[0]?.id

  const tasks = useQuery({
    queryKey: ['entry-tasks', effectiveProject],
    queryFn: () => api.get<Page<Task>>(`/projects/${effectiveProject}/tasks?page_size=200`),
    enabled: open && !!effectiveProject,
  })

  const create = useMutation({
    mutationFn: () => {
      const started = new Date(`${date}T${startTime}:00`)
      const durationMs = (parseInt(hours || '0', 10) * 60 + parseInt(minutes || '0', 10)) * 60_000
      const ended = new Date(started.getTime() + durationMs)
      return api.post(`/tasks/${taskId || tasks.data?.items[0]?.id}/time-entries`, {
        started_at: started.toISOString(),
        ended_at: ended.toISOString(),
        description: description.trim() || null,
      })
    },
    onSuccess: () => {
      toast.success('Time entry added')
      void queryClient.invalidateQueries({ queryKey: ['timesheet'] })
      void queryClient.invalidateQueries({ queryKey: ['my-time'] })
      onCreated()
      onClose()
    },
    onError: (err) => toast.error(errorMessage(err)),
  })

  const durationValid = parseInt(hours || '0', 10) * 60 + parseInt(minutes || '0', 10) > 0
  const effectiveTask = taskId || tasks.data?.items[0]?.id

  return (
    <Modal open={open} onClose={onClose} title="Create time entry" width="max-w-md">
      <div className="space-y-3">
        <div>
          <label className="mb-1.5 block text-xs font-medium text-fg-secondary">Project</label>
          <select className="input-dark" value={projectId} onChange={(e) => { setProjectId(e.target.value); setTaskId('') }}>
            {(projects.data ?? []).map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="mb-1.5 block text-xs font-medium text-fg-secondary">Task</label>
          <select className="input-dark" value={taskId} onChange={(e) => setTaskId(e.target.value)}>
            {(tasks.data?.items ?? []).map((t) => (
              <option key={t.id} value={t.id}>
                {t.ref} — {t.title}
              </option>
            ))}
          </select>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <div>
            <label className="mb-1.5 block text-xs font-medium text-fg-secondary">Date</label>
            <input type="date" className="input-dark" value={date} onChange={(e) => setDate(e.target.value)} />
          </div>
          <div>
            <label className="mb-1.5 block text-xs font-medium text-fg-secondary">Start time</label>
            <input type="time" className="input-dark" value={startTime} onChange={(e) => setStartTime(e.target.value)} />
          </div>
        </div>
        <div>
          <label className="mb-1.5 block text-xs font-medium text-fg-secondary">Duration</label>
          <div className="flex items-center gap-2">
            <input className="input-dark !w-20" value={hours} onChange={(e) => setHours(e.target.value.replace(/\D/g, ''))} />
            <span className="text-xs text-fg-muted">h</span>
            <input className="input-dark !w-20" value={minutes} onChange={(e) => setMinutes(e.target.value.replace(/\D/g, ''))} />
            <span className="text-xs text-fg-muted">m</span>
          </div>
        </div>
        <input className="input-dark" placeholder="Description (optional)" value={description} onChange={(e) => setDescription(e.target.value)} />
        <button
          className="btn-primary w-full"
          disabled={!effectiveTask || !durationValid || create.isPending}
          onClick={() => create.mutate()}
        >
          {create.isPending ? 'Saving…' : 'Add entry'}
        </button>
      </div>
    </Modal>
  )
}
