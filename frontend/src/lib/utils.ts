import type { Priority } from './types'

export function cn(...parts: (string | false | null | undefined)[]): string {
  return parts.filter(Boolean).join(' ')
}

export function initials(name: string): string {
  const parts = name.trim().split(/\s+/)
  if (parts.length === 0 || !parts[0]) return '?'
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase()
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
}

const AVATAR_COLORS = [
  '#2B88EE', '#E5484D', '#F2994A', '#4CB782', '#5B9FF0', '#07BEA3', '#E667A8', '#26B5CE',
]

export function avatarColor(seed: string): string {
  let hash = 0
  for (let i = 0; i < seed.length; i++) hash = (hash * 31 + seed.charCodeAt(i)) | 0
  return AVATAR_COLORS[Math.abs(hash) % AVATAR_COLORS.length]
}

export const PRIORITY_COLORS: Record<Priority, string> = {
  urgent: '#E5484D',
  high: '#F2994A',
  normal: '#5B9FF0',
  low: '#87909E',
}

export const PRIORITY_LABELS: Record<Priority, string> = {
  urgent: 'Urgent',
  high: 'High',
  normal: 'Normal',
  low: 'Low',
}

export const TASK_TYPE_LABELS: Record<string, string> = {
  task: 'Task',
  bug: 'Bug',
  story: 'Story',
  epic: 'Epic',
}

/** Parse YYYY-MM-DD (and ISO datetimes) without UTC timezone drift. */
export function parseAppDate(iso: string | null | undefined): Date | null {
  if (!iso) return null
  const trimmed = iso.trim()
  const dateOnly = trimmed.match(/^(\d{4})-(\d{2})-(\d{2})$/)
  if (dateOnly) {
    const year = Number(dateOnly[1])
    const month = Number(dateOnly[2])
    const day = Number(dateOnly[3])
    if (year < 1900 || year > 2100 || month < 1 || month > 12 || day < 1 || day > 31) return null
    return new Date(year, month - 1, day)
  }
  const date = new Date(trimmed)
  return Number.isNaN(date.getTime()) ? null : date
}

/** Value for <input type="date"> — always YYYY-MM-DD in local calendar. */
export function toDateInputValue(iso: string | null | undefined): string {
  if (!iso) return ''
  const dateOnly = iso.trim().match(/^(\d{4})-(\d{2})-(\d{2})$/)
  if (dateOnly) {
    const year = Number(dateOnly[1])
    if (year < 1900 || year > 2100) return ''
    return `${dateOnly[1]}-${dateOnly[2]}-${dateOnly[3]}`
  }
  const date = parseAppDate(iso)
  if (!date) return ''
  const year = date.getFullYear()
  if (year < 1900 || year > 2100) return ''
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

export function formatDate(iso: string | null | undefined): string {
  const date = parseAppDate(iso)
  if (!date) return ''
  const now = new Date()
  const sameYear = date.getFullYear() === now.getFullYear()
  return date.toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    ...(sameYear ? {} : { year: 'numeric' }),
  })
}

export function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return ''
  return new Date(iso).toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  })
}

export function timeAgo(iso: string): string {
  const seconds = Math.floor((Date.now() - new Date(iso).getTime()) / 1000)
  if (seconds < 60) return 'just now'
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  if (days < 7) return `${days}d ago`
  return formatDate(iso)
}

export function formatDuration(totalSeconds: number): string {
  const safe = Math.max(0, Math.floor(totalSeconds))
  const d = Math.floor(safe / 86400)
  const h = Math.floor((safe % 86400) / 3600)
  const m = Math.floor((safe % 3600) / 60)
  const s = safe % 60
  if (d > 0) return h > 0 ? `${d}d ${h}h ${m}m` : `${d}d ${m}m`
  if (h > 0) return `${h}h ${m}m`
  if (m > 0) return s > 0 ? `${m}m ${s}s` : `${m}m`
  return `${s}s`
}

/** Live timer display: HH:MM:SS, or D:HH:MM:SS when duration spans days. */
export function formatTimer(totalSeconds: number): string {
  const safe = Math.max(0, Math.floor(totalSeconds))
  const d = Math.floor(safe / 86400)
  const h = Math.floor((safe % 86400) / 3600)
  const m = Math.floor((safe % 3600) / 60)
  const s = safe % 60
  const pad = (n: number) => String(n).padStart(2, '0')
  if (d > 0) return `${d}:${pad(h)}:${pad(m)}:${pad(s)}`
  return `${pad(h)}:${pad(m)}:${pad(s)}`
}

export type DurationParts = { days: number; hours: number; minutes: number; seconds: number }

export function splitDurationParts(totalSeconds: number): DurationParts {
  const safe = Math.max(0, Math.floor(totalSeconds || 0))
  return {
    days: Math.floor(safe / 86400),
    hours: Math.floor((safe % 86400) / 3600),
    minutes: Math.floor((safe % 3600) / 60),
    seconds: safe % 60,
  }
}

export function combineDurationParts(parts: Partial<DurationParts>): number {
  const d = Math.max(0, Math.floor(Number(parts.days) || 0))
  const h = Math.max(0, Math.floor(Number(parts.hours) || 0))
  const m = Math.max(0, Math.floor(Number(parts.minutes) || 0))
  const s = Math.max(0, Math.floor(Number(parts.seconds) || 0))
  return d * 86400 + h * 3600 + m * 60 + s
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

export function isOverdue(dueDate: string | null, completedAt: string | null): boolean {
  if (!dueDate || completedAt) return false
  const due = new Date(dueDate + 'T23:59:59')
  return due.getTime() < Date.now()
}

/** Matches mention markup `@[Name](uuid)` and the @all sentinel `@[All](all)`. */
export const MENTION_MARKUP_RE = /@\[([^\]]+)\]\((?:[0-9a-fA-F-]{36}|all)\)/g

/** Matches task-link markup `#[REF](task-uuid)` produced by the chat composer. */
export const TASK_MARKUP_RE = /#\[([^\]]+)\]\(([0-9a-fA-F-]{36})\)/g

/** Render mention markup `@[Name](uuid)` as plain @Name for display. */
export function renderMentions(body: string): string {
  return body.replace(MENTION_MARKUP_RE, '@$1')
}

/** Strip mention + task markup down to the plain text the user originally typed. */
export function toPlainBody(body: string): string {
  return body.replace(MENTION_MARKUP_RE, '@$1').replace(TASK_MARKUP_RE, '#$1')
}

/**
 * Convert a composer's clean text (`@Name`) into backend mention markup
 * (`@[Name](uuid)`), using the display-name → id map collected as the user
 * picked mentions. `id` may be the literal `"all"` sentinel for @all.
 */
export function toMentionMarkup(text: string, mentionMap: Map<string, string>): string {
  if (mentionMap.size === 0) return text
  // Replace longest names first so "@Alice Smith" wins over "@Alice".
  const entries = [...mentionMap.entries()].sort((a, b) => b[0].length - a[0].length)
  let out = text
  for (const [name, id] of entries) {
    const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    out = out.replace(new RegExp(`@${escaped}(?!\\w)`, 'g'), `@[${name}](${id})`)
  }
  return out
}

// ---- Calendar / Gantt date helpers ----

/** Local date key YYYY-MM-DD (matches the API's date-only fields). */
export function toDateKey(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

/** Today's date as YYYY-MM-DD in the browser's local calendar. */
export function todayDateKey(): string {
  const now = new Date()
  return toDateKey(new Date(now.getFullYear(), now.getMonth(), now.getDate()))
}

/** Calendar date key YYYY-MM-DD in a specific IANA timezone (e.g. Asia/Kolkata or IST). */
export function dateKeyInTimezone(timeZone: string, date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: normalizeTimezone(timeZone),
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date)
}

export function todayDateKeyInTimezone(timeZone: string): string {
  return dateKeyInTimezone(timeZone)
}

/** Map common abbreviations to IANA zones for display formatting. */
export function normalizeTimezone(timeZone: string): string {
  const key = timeZone.trim()
  const aliases: Record<string, string> = {
    UTC: 'UTC',
    GMT: 'UTC',
    IST: 'Asia/Kolkata',
    EST: 'America/New_York',
    PST: 'America/Los_Angeles',
    JST: 'Asia/Tokyo',
    CET: 'Europe/Paris',
    AEST: 'Australia/Sydney',
  }
  return aliases[key.toUpperCase()] ?? key
}

export function formatDateTimeInTimezone(
  iso: string | null | undefined,
  timeZone: string,
): string {
  if (!iso) return ''
  return new Date(iso).toLocaleString(undefined, {
    timeZone: normalizeTimezone(timeZone),
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  })
}

export function formatHourInTimezone(iso: string, timeZone: string): string {
  return new Date(iso).toLocaleString('en-GB', {
    timeZone: normalizeTimezone(timeZone),
    hour: '2-digit',
    hour12: false,
  })
}

export function formatTimezoneLabel(timeZone: string): string {
  const normalized = normalizeTimezone(timeZone)
  if (normalized === 'Asia/Kolkata' && timeZone.trim().toUpperCase() === 'IST') return 'IST'
  return normalized
}

/** Earliest selectable date — keeps an existing past value when editing legacy records. */
export function minSelectableDateKey(existing?: string | null): string {
  const today = todayDateKey()
  if (!existing || existing >= today) return today
  return existing
}

/** Minimum end date given a start date (and optional existing end when editing). */
export function minEndDateKey(startDate: string, existingEnd?: string | null): string {
  const today = todayDateKey()
  let min = startDate && startDate > today ? startDate : today
  if (existingEnd && existingEnd < min) min = existingEnd
  return min
}

export function addDays(date: Date, days: number): Date {
  const next = new Date(date)
  next.setDate(next.getDate() + days)
  return next
}

export function startOfWeek(date: Date): Date {
  const d = new Date(date)
  d.setHours(0, 0, 0, 0)
  d.setDate(d.getDate() - d.getDay()) // Sunday
  return d
}

export function isoWeek(date: Date): number {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()))
  const dayNum = d.getUTCDay() || 7
  d.setUTCDate(d.getUTCDate() + 4 - dayNum)
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1))
  return Math.ceil(((d.getTime() - yearStart.getTime()) / 86400000 + 1) / 7)
}

export function daysBetween(a: Date, b: Date): number {
  return Math.round((b.getTime() - a.getTime()) / 86400000)
}
