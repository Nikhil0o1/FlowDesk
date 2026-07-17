import { ChevronLeft, ChevronRight } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'

import { addDays, cn, parseAppDate, startOfWeek, toDateInputValue, toDateKey } from '../../lib/utils'
import { toast } from '../../stores/toast'

const WEEKDAYS = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa']

const MONTH_LABELS = Array.from({ length: 12 }, (_, month) =>
  new Date(2000, month, 1).toLocaleDateString(undefined, { month: 'short' }),
)

function parseDateKey(value: string | null | undefined): Date | null {
  if (!value) return null
  const trimmed = value.trim()
  // Accept zero-padded YYYY-MM-DD and loosely typed forms like 2026-7-8.
  const loose = trimmed.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/)
  if (loose) {
    const year = Number(loose[1])
    const month = Number(loose[2])
    const day = Number(loose[3])
    if (year < 1900 || year > 2100 || month < 1 || month > 12 || day < 1 || day > 31) return null
    const date = new Date(year, month - 1, day)
    // Reject overflow dates like 2026-02-31.
    if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) return null
    return date
  }
  return parseAppDate(trimmed)
}

function yearBounds(min?: string, max?: string) {
  const minYear = parseDateKey(min)?.getFullYear() ?? 1900
  const maxYear = parseDateKey(max)?.getFullYear() ?? 2100
  return { minYear: Math.min(minYear, maxYear), maxYear: Math.max(minYear, maxYear) }
}

const NAV_BTN =
  'flex h-6 w-6 shrink-0 items-center justify-center rounded-lg text-fg-muted transition-colors hover:bg-ink-750 hover:text-fg'

/**
 * The one calendar used everywhere in FlowDesk (due dates, start dates, sprints,
 * timesheet, planner). Renders at a fixed height so floating panels never jump.
 */
export function InlineCalendar({
  value,
  onSelect,
  min,
  max,
  onClear,
  clearLabel = 'Clear',
}: {
  value: string | null
  onSelect: (dateKey: string) => void
  min?: string
  max?: string
  onClear?: () => void
  clearLabel?: string
}) {
  const selected = parseDateKey(value)
  const today = useMemo(() => {
    const now = new Date()
    return new Date(now.getFullYear(), now.getMonth(), now.getDate())
  }, [])
  const todayKey = toDateKey(today)

  const [mode, setMode] = useState<'days' | 'months'>('days')
  const [viewMonth, setViewMonth] = useState(() => {
    const anchor = selected ?? today
    return new Date(anchor.getFullYear(), anchor.getMonth(), 1)
  })
  const [inputValue, setInputValue] = useState(() => toDateInputValue(value) || '')

  const { minYear, maxYear } = useMemo(() => yearBounds(min, max), [min, max])

  // Sync the visible month when the selected value changes, but don't reset
  // month navigation while the user is browsing without selecting.
  useEffect(() => {
    const parsed = parseDateKey(value)
    setInputValue(toDateInputValue(value) || '')
    if (!parsed) return
    const next = new Date(parsed.getFullYear(), parsed.getMonth(), 1)
    setViewMonth((current) => {
      if (current.getFullYear() === next.getFullYear() && current.getMonth() === next.getMonth()) {
        return current
      }
      return next
    })
  }, [value])

  const gridStart = startOfWeek(new Date(viewMonth.getFullYear(), viewMonth.getMonth(), 1))
  const days = Array.from({ length: 42 }, (_, i) => addDays(gridStart, i))

  const isDisabled = (dateKey: string) => {
    if (min && dateKey < min) return true
    if (max && dateKey > max) return true
    return false
  }

  const goToMonth = (year: number, month: number) => {
    const clampedYear = Math.min(maxYear, Math.max(minYear, year))
    setViewMonth(new Date(clampedYear, month, 1))
  }

  const pick = (dateKey: string) => {
    const parsed = parseDateKey(dateKey)
    if (!parsed || isDisabled(dateKey)) return
    onSelect(dateKey)
    setInputValue(dateKey)
    setViewMonth(new Date(parsed.getFullYear(), parsed.getMonth(), 1))
    setMode('days')
  }

  const applyInput = () => {
    const trimmed = inputValue.trim()
    if (!trimmed) return
    const parsed = parseDateKey(trimmed)
    if (!parsed) {
      toast.error('Enter a valid date as YYYY-MM-DD')
      setInputValue(toDateInputValue(value) || '')
      return
    }
    const key = toDateKey(parsed)
    if (isDisabled(key)) {
      toast.error(
        min && key < min && min === toDateKey(today)
          ? 'Date cannot be in the past'
          : 'Date is outside the allowed range',
      )
      setInputValue(toDateInputValue(value) || '')
      return
    }
    pick(key)
  }

  const monthTitle = viewMonth.toLocaleDateString(undefined, { month: 'long', year: 'numeric' })
  const viewYear = viewMonth.getFullYear()

  const presets = useMemo(
    () =>
      [
        { label: 'Today', key: todayKey },
        { label: 'Tomorrow', key: toDateKey(addDays(today, 1)) },
        { label: 'Next week', key: toDateKey(addDays(today, 7)) },
      ].filter((preset) => !isDisabled(preset.key)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [todayKey, min, max],
  )

  const monthDisabled = (month: number) => {
    const monthStart = toDateKey(new Date(viewYear, month, 1))
    const monthEnd = toDateKey(new Date(viewYear, month + 1, 0))
    if (min && monthEnd < min) return true
    if (max && monthStart > max) return true
    return false
  }

  return (
    <div className="select-none">
      <input
        type="text"
        inputMode="numeric"
        className="input-dark mb-1.5 w-full !py-1 text-xs tabular-nums"
        placeholder="YYYY-MM-DD"
        value={inputValue}
        onChange={(e) => setInputValue(e.target.value)}
        onBlur={applyInput}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault()
            applyInput()
          }
        }}
        aria-label="Date"
      />

      <div className="mb-1 flex items-center justify-between">
        <button
          type="button"
          className={NAV_BTN}
          aria-label={mode === 'days' ? 'Previous month' : 'Previous year'}
          onClick={() =>
            mode === 'days'
              ? goToMonth(viewYear, viewMonth.getMonth() - 1)
              : goToMonth(viewYear - 1, viewMonth.getMonth())
          }
        >
          <ChevronLeft size={14} />
        </button>
        <button
          type="button"
          className="rounded-lg px-2 py-0.5 text-xs font-semibold text-fg transition-colors hover:bg-ink-750"
          aria-label={mode === 'days' ? 'Choose month and year' : 'Back to days'}
          onClick={() => setMode((m) => (m === 'days' ? 'months' : 'days'))}
        >
          {mode === 'days' ? monthTitle : viewYear}
        </button>
        <button
          type="button"
          className={NAV_BTN}
          aria-label={mode === 'days' ? 'Next month' : 'Next year'}
          onClick={() =>
            mode === 'days'
              ? goToMonth(viewYear, viewMonth.getMonth() + 1)
              : goToMonth(viewYear + 1, viewMonth.getMonth())
          }
        >
          <ChevronRight size={14} />
        </button>
      </div>

      {/* Fixed-height stage: days grid and month picker occupy the same box, so
          the floating panel never changes size (and never overflows the screen). */}
      <div className="h-[188px]">
        {mode === 'days' ? (
          <div className="grid grid-cols-7 gap-y-0">
            {WEEKDAYS.map((day) => (
              <div
                key={day}
                className="pb-0.5 text-center text-[9px] font-semibold uppercase tracking-wide text-fg-muted"
              >
                {day}
              </div>
            ))}
            {days.map((date) => {
              const dateKey = toDateKey(date)
              const inMonth = date.getMonth() === viewMonth.getMonth()
              const isSelected = value === dateKey
              const isToday = dateKey === todayKey
              const disabled = isDisabled(dateKey)

              return (
                <button
                  key={dateKey}
                  type="button"
                  disabled={disabled}
                  aria-label={dateKey}
                  aria-pressed={isSelected}
                  onClick={() => pick(dateKey)}
                  className={cn(
                    'mx-auto flex h-7 w-7 items-center justify-center rounded-full text-[11px] tabular-nums transition-colors',
                    disabled && 'cursor-not-allowed text-fg-muted/25',
                    !disabled &&
                      isSelected &&
                      'bg-brand font-semibold text-white shadow-sm hover:bg-brand',
                    !disabled &&
                      !isSelected &&
                      isToday &&
                      'font-semibold text-brand ring-1 ring-inset ring-brand/40 hover:bg-brand-soft',
                    !disabled &&
                      !isSelected &&
                      !isToday &&
                      (inMonth
                        ? 'text-fg-secondary hover:bg-ink-750 hover:text-fg'
                        : 'text-fg-muted/40 hover:bg-ink-750 hover:text-fg-muted'),
                  )}
                >
                  {date.getDate()}
                </button>
              )
            })}
          </div>
        ) : (
          <div className="grid grid-cols-3 content-start gap-1 pt-0.5">
            {MONTH_LABELS.map((label, month) => {
              const disabled = monthDisabled(month)
              const isViewed = viewMonth.getMonth() === month
              const isTodayMonth =
                today.getFullYear() === viewYear && today.getMonth() === month

              return (
                <button
                  key={label}
                  type="button"
                  disabled={disabled}
                  aria-label={`${new Date(2000, month, 1).toLocaleDateString(undefined, { month: 'long' })} ${viewYear}`}
                  onClick={() => {
                    goToMonth(viewYear, month)
                    setMode('days')
                  }}
                  className={cn(
                    'rounded-lg py-2 text-[11px] font-medium transition-colors',
                    disabled && 'cursor-not-allowed text-fg-muted/25',
                    !disabled &&
                      (isViewed
                        ? 'bg-brand font-semibold text-white shadow-sm'
                        : isTodayMonth
                          ? 'font-semibold text-brand ring-1 ring-inset ring-brand/40 hover:bg-brand-soft'
                          : 'text-fg-secondary hover:bg-ink-750 hover:text-fg'),
                  )}
                >
                  {label}
                </button>
              )
            })}
          </div>
        )}
      </div>

      <div className="mt-1 flex items-center gap-1 border-t border-ink-700 pt-1">
        {presets.map((preset) => (
          <button
            key={preset.label}
            type="button"
            className="rounded-md px-2 py-1 text-[11px] font-medium text-fg-secondary transition-colors hover:bg-ink-750 hover:text-fg"
            onClick={() => pick(preset.key)}
          >
            {preset.label}
          </button>
        ))}
        <span className="flex-1" />
        {onClear && (
          <button
            type="button"
            className="rounded-md px-2 py-1 text-[11px] font-medium text-fg-muted transition-colors hover:bg-ink-750 hover:text-red-400"
            onClick={onClear}
          >
            {clearLabel}
          </button>
        )}
      </div>
    </div>
  )
}
