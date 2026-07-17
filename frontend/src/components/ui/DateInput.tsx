import { Calendar } from 'lucide-react'

import { cn, formatDate, toDateInputValue } from '../../lib/utils'
import { DatePicker } from '../tasks/pickers'

/** Form-friendly date control with calendar popup (replaces native type="date"). */
export function DateInput({
  value,
  onChange,
  min = null,
  max,
  className,
  placeholder = 'Pick date',
  id,
}: {
  value: string
  onChange: (value: string) => void
  /** Earliest selectable date. Defaults to unbounded — forms (timesheet, planner
   *  events, sprints) set their own rule; task pickers use DatePicker directly. */
  min?: string | null
  max?: string
  className?: string
  placeholder?: string
  id?: string
}) {
  const normalized = toDateInputValue(value) || null

  return (
    <DatePicker
      value={normalized}
      onChange={(next) => onChange(next ?? '')}
      min={min}
      max={max}
      closeOnSelect
    >
      <button
        id={id}
        type="button"
        className={cn(
          'input-dark flex w-full items-center gap-2 text-left text-sm',
          !normalized && 'text-fg-muted',
          className,
        )}
      >
        <Calendar size={14} className="shrink-0 text-fg-muted" />
        <span className="truncate">{normalized ? formatDate(normalized) : placeholder}</span>
      </button>
    </DatePicker>
  )
}
