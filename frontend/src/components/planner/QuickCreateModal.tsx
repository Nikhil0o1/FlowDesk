import { AlignLeft, Globe, Lock, MapPin, Plus, Users, Video, X } from 'lucide-react'
import { useState } from 'react'

import { api, errorMessage } from '../../lib/api'
import { dayKey } from '../../lib/planner'
import { useCurrentContext, useProjects } from '../../lib/queries'
import { cn, todayDateKey } from '../../lib/utils'
import { useAuthStore } from '../../stores/auth'
import { toast } from '../../stores/toast'
import { Modal } from '../ui/Modal'
import { DateInput } from '../ui/DateInput'
import { DurationPartsInputs } from '../ui/DurationPartsInputs'
import { CreateGithubIssueToggle, useCreateGithubIssuePreference } from '../github/CreateGithubIssueToggle'

type Tab = 'event' | 'task' | 'focus' | 'ooo'
const TABS: { key: Tab; label: string }[] = [
  { key: 'event', label: 'Event' },
  { key: 'task', label: 'Task' },
  { key: 'focus', label: 'Focus time' },
  { key: 'ooo', label: 'OOO' },
]
const pad = (n: number) => String(n).padStart(2, '0')

export function QuickCreateModal({
  slot,
  onClose,
  onCreated,
}: {
  slot: { day: Date; hour: number }
  onClose: () => void
  onCreated: () => void
}) {
  const user = useAuthStore((s) => s.user)
  const { workspace } = useCurrentContext()
  const projects = useProjects(workspace?.id)

  const [tab, setTab] = useState<Tab>('event')
  const [title, setTitle] = useState('')
  const [date, setDate] = useState(dayKey(slot.day))
  const [startTime, setStartTime] = useState(`${pad(slot.hour)}:00`)
  const [endTime, setEndTime] = useState(`${pad((slot.hour + 1) % 24)}:00`)
  const [allDay, setAllDay] = useState(false)
  const [submitting, setSubmitting] = useState(false)

  // Event extras
  const [addMeet, setAddMeet] = useState(false)
  const [participantInput, setParticipantInput] = useState('')
  const [participants, setParticipants] = useState<string[]>([])
  const [location, setLocation] = useState('')
  const [description, setDescription] = useState('')
  const [visibility, setVisibility] = useState<'default' | 'private'>('default')
  const [busyFree, setBusyFree] = useState<'opaque' | 'transparent'>('opaque')
  const [repeat, setRepeat] = useState<'none' | 'daily' | 'weekly' | 'monthly'>('none')

  // Task extras
  const [projectId, setProjectId] = useState('')
  const [priority, setPriority] = useState('')
  const [tag, setTag] = useState('')
  const [estimateSeconds, setEstimateSeconds] = useState(0)
  const [createGithubIssue, setCreateGithubIssue] = useCreateGithubIssuePreference()

  const effectiveProjectId = projectId || projects.data?.[0]?.id || ''

  // Focus / OOO
  const [doNotDecline, setDoNotDecline] = useState(true)

  const startISO = () => new Date(`${date}T${allDay ? '00:00' : startTime}`).toISOString()
  const endISO = () => new Date(`${date}T${allDay ? '23:59' : endTime}`).toISOString()

  const addParticipant = () => {
    const e = participantInput.trim()
    if (e && !participants.includes(e)) setParticipants((p) => [...p, e])
    setParticipantInput('')
  }

  const create = async () => {
    if (!title.trim() && tab !== 'ooo') return
    setSubmitting(true)
    try {
      if (tab === 'task') {
        const pid = projectId || projects.data?.[0]?.id
        if (!pid) throw new Error('No project available')
        await api.post(`/projects/${pid}/tasks`, {
          title: title.trim(),
          due_date: date,
          planned_start_at: startISO(),
          planned_end_at: endISO(),
          assignee_ids: user ? [user.id] : [],
          priority: priority || undefined,
          labels: tag.trim() ? [tag.trim()] : [],
          time_estimate_seconds: estimateSeconds > 0 ? estimateSeconds : undefined,
          description: description.trim() || undefined,
          sync_to_google: true,
          create_github_issue: createGithubIssue,
        })
        toast.success('Task scheduled and synced to Google Calendar')
      } else {
        const eventType = tab === 'focus' ? 'focusTime' : tab === 'ooo' ? 'outOfOffice' : 'default'
        const res = await api.post<{ meet_link?: string | null }>('/calendar/events', {
          summary: title.trim() || (tab === 'ooo' ? 'Out of office' : 'Focus time'),
          description: description.trim() || undefined,
          start_at: startISO(),
          end_at: endISO(),
          all_day: allDay,
          location: tab === 'event' ? location.trim() || undefined : undefined,
          attendees: tab === 'event' ? participants : [],
          add_meet: tab === 'event' && addMeet,
          visibility,
          transparency: busyFree,
          recurrence: tab === 'event' ? repeat : 'none',
          event_type: eventType,
          auto_decline: (tab === 'focus' || tab === 'ooo') && !doNotDecline,
        })
        toast.success(res.meet_link ? `Event created — Meet link added` : 'Event added to your Google Calendar')
      }
      onCreated()
      onClose()
    } catch (err) {
      toast.error(errorMessage(err))
    } finally {
      setSubmitting(false)
    }
  }

  const titlePlaceholder =
    tab === 'task' ? 'Task name'
      : tab === 'focus' ? 'Add title, e.g. Focus: A1B2C3D4-12'
        : tab === 'ooo' ? 'Add title'
          : 'Add title, participants & a video call'

  return (
    <Modal open onClose={onClose} title="" width="max-w-lg">
      {/* Tabs */}
      <div className="-mt-2 mb-3 flex gap-1 border-b border-ink-700">
        {TABS.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={cn(
              '-mb-px border-b-2 px-3 py-2 text-sm font-medium transition-colors',
              tab === t.key ? 'border-fg text-fg' : 'border-transparent text-fg-muted hover:text-fg-secondary',
            )}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div className="space-y-3">
        {tab === 'task' && (
          <select className="input-dark text-sm" value={projectId} onChange={(e) => setProjectId(e.target.value)}>
            {(projects.data ?? []).map((p) => (<option key={p.id} value={p.id}>{p.name}</option>))}
          </select>
        )}

        <input
          autoFocus
          className="input-dark text-base font-medium"
          placeholder={titlePlaceholder}
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && void create()}
        />

        {/* Date / time row */}
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <DateInput
            value={date}
            onChange={setDate}
            min={tab === 'task' ? todayDateKey() : undefined}
            className="!w-auto !py-1"
            placeholder="Date"
          />
          {!allDay && (
            <>
              <input type="time" className="input-dark !w-auto !py-1" value={startTime} onChange={(e) => setStartTime(e.target.value)} />
              <span className="text-fg-muted">→</span>
              <input type="time" className="input-dark !w-auto !py-1" value={endTime} onChange={(e) => setEndTime(e.target.value)} />
            </>
          )}
          {tab !== 'task' && tab !== 'focus' && tab !== 'ooo' && (
            <label className="ml-1 flex items-center gap-1.5 text-fg-secondary">
              <input type="checkbox" checked={allDay} onChange={(e) => setAllDay(e.target.checked)} /> All day
            </label>
          )}
          {tab === 'event' && (
            <select className="input-dark !w-auto !py-1 text-xs" value={repeat} onChange={(e) => setRepeat(e.target.value as any)}>
              <option value="none">No repeat</option>
              <option value="daily">Daily</option>
              <option value="weekly">Weekly</option>
              <option value="monthly">Monthly</option>
            </select>
          )}
        </div>

        {/* ---- EVENT ---- */}
        {tab === 'event' && (
          <>
            <button
              className={cn(
                'flex w-full items-center justify-center gap-2 rounded-lg border px-4 py-2 text-sm font-medium transition-colors',
                addMeet ? 'border-emerald-700/60 bg-emerald-950/30 text-emerald-300' : 'border-ink-700 bg-ink-900 text-fg-secondary hover:border-ink-600',
              )}
              onClick={() => setAddMeet((v) => !v)}
            >
              <Video size={15} /> {addMeet ? 'Google Meet will be added' : 'Add video call'}
            </button>
            <p className="-mt-1 text-[11px] text-fg-muted">Google Meet · Zoom (unavailable)</p>

            <FieldRow icon={Users} label="Participants">
              <div className="flex flex-wrap items-center gap-1">
                {participants.map((p) => (
                  <span key={p} className="flex items-center gap-1 rounded-full bg-ink-750 px-2 py-0.5 text-xs text-fg">
                    {p}
                    <button onClick={() => setParticipants((list) => list.filter((x) => x !== p))}><X size={11} /></button>
                  </span>
                ))}
                <input
                  className="min-w-[140px] flex-1 bg-transparent text-sm outline-none placeholder:text-fg-muted"
                  placeholder="Add by email"
                  value={participantInput}
                  onChange={(e) => setParticipantInput(e.target.value)}
                  onKeyDown={(e) => (e.key === 'Enter' || e.key === ',') && (e.preventDefault(), addParticipant())}
                  onBlur={addParticipant}
                />
              </div>
            </FieldRow>

            <FieldRow icon={MapPin} label="Location">
              <input className="w-full bg-transparent text-sm outline-none placeholder:text-fg-muted" placeholder="Add location or room" value={location} onChange={(e) => setLocation(e.target.value)} />
            </FieldRow>
          </>
        )}

        {/* ---- TASK ---- */}
        {tab === 'task' && (
          <div className="grid grid-cols-2 gap-2">
            <select className="input-dark !py-1.5 text-sm" value={priority} onChange={(e) => setPriority(e.target.value)}>
              <option value="">No priority</option>
              <option value="urgent">Urgent</option>
              <option value="high">High</option>
              <option value="normal">Normal</option>
              <option value="low">Low</option>
            </select>
            <input className="input-dark !py-1.5 text-sm" placeholder="Add a tag" value={tag} onChange={(e) => setTag(e.target.value)} />
            <div className="col-span-2">
              <p className="mb-1 text-[11px] text-fg-muted">Time estimate</p>
              <DurationPartsInputs valueSeconds={estimateSeconds} onChange={setEstimateSeconds} />
            </div>
          </div>
        )}
        {tab === 'task' && effectiveProjectId && (
          <CreateGithubIssueToggle
            projectId={effectiveProjectId}
            checked={createGithubIssue}
            onChange={setCreateGithubIssue}
          />
        )}

        {/* ---- FOCUS / OOO ---- */}
        {(tab === 'focus' || tab === 'ooo') && (
          <label className="flex items-center gap-2 text-sm text-fg-secondary">
            <input type="checkbox" checked={doNotDecline} onChange={(e) => setDoNotDecline(e.target.checked)} />
            Do not decline meetings
          </label>
        )}

        {/* Description (all tabs) */}
        <FieldRow icon={AlignLeft} label="Description">
          <textarea className="w-full resize-none bg-transparent text-sm outline-none placeholder:text-fg-muted" rows={2} placeholder="Add description" value={description} onChange={(e) => setDescription(e.target.value)} />
        </FieldRow>

        {/* Footer: visibility / busy (regular events only — focus/OOO are always busy per Google) */}
        {tab === 'event' && (
          <div className="flex items-center gap-3 border-t border-ink-700 pt-3 text-xs">
            <button
              className="flex items-center gap-1.5 text-fg-secondary hover:text-fg"
              onClick={() => setVisibility((v) => (v === 'private' ? 'default' : 'private'))}
            >
              {visibility === 'private' ? <Lock size={13} /> : <Globe size={13} />}
              {visibility === 'private' ? 'Private' : 'Default'}
            </button>
            <span className="text-ink-600">·</span>
            <button
              className="text-fg-secondary hover:text-fg"
              onClick={() => setBusyFree((b) => (b === 'opaque' ? 'transparent' : 'opaque'))}
            >
              {busyFree === 'opaque' ? 'Busy' : 'Free'}
            </button>
          </div>
        )}

        <button className="btn-primary w-full" disabled={submitting || (!title.trim() && tab !== 'ooo')} onClick={() => void create()}>
          <Plus size={14} />
          {tab === 'task' ? 'Create task' : tab === 'focus' ? 'Create focus time' : tab === 'ooo' ? 'Set OOO' : 'Create event'}
        </button>
      </div>
    </Modal>
  )
}

function FieldRow({ icon: Icon, label, children }: { icon: React.ElementType; label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-start gap-2.5 rounded-lg border border-ink-700 bg-ink-900 px-3 py-2">
      <Icon size={15} className="mt-0.5 shrink-0 text-fg-muted" />
      <div className="min-w-0 flex-1" aria-label={label}>{children}</div>
    </div>
  )
}
