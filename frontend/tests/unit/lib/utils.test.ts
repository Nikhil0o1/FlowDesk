import { describe, expect, it } from 'vitest'

import {
  addDays,
  cn,
  combineDurationParts,
  formatDate,
  formatDateTimeInTimezone,
  formatDuration,
  formatHourInTimezone,
  formatTimer,
  formatTimezoneLabel,
  initials,
  isOverdue,
  normalizeTimezone,
  parseAppDate,
  renderMentions,
  splitDurationParts,
  startOfWeek,
  toDateInputValue,
  toDateKey,
  toMentionMarkup,
} from '@/lib/utils'

describe('cn', () => {
  it('joins truthy class names', () => {
    expect(cn('a', false && 'b', undefined, 'c')).toBe('a c')
  })
})

describe('initials', () => {
  it('returns two letters for a single name', () => {
    expect(initials('Alice')).toBe('AL')
  })

  it('returns first and last initials for full names', () => {
    expect(initials('Alice Smith')).toBe('AS')
  })

  it('returns ? for empty input', () => {
    expect(initials('   ')).toBe('?')
  })
})

describe('parseAppDate', () => {
  it('parses YYYY-MM-DD without UTC drift', () => {
    const date = parseAppDate('2026-06-17')
    expect(date?.getFullYear()).toBe(2026)
    expect(date?.getMonth()).toBe(5)
    expect(date?.getDate()).toBe(17)
  })

  it('returns null for invalid date-only values', () => {
    expect(parseAppDate('2026-13-40')).toBeNull()
    expect(parseAppDate(null)).toBeNull()
    expect(parseAppDate('')).toBeNull()
    expect(parseAppDate('1899-01-01')).toBeNull()
  })

  it('parses ISO datetimes', () => {
    const date = parseAppDate('2026-06-17T12:00:00Z')
    expect(date).not.toBeNull()
  })
})

describe('toDateInputValue', () => {
  it('returns date-only strings unchanged', () => {
    expect(toDateInputValue('2026-06-17')).toBe('2026-06-17')
  })

  it('returns empty for null, blank, or out-of-range years', () => {
    expect(toDateInputValue(null)).toBe('')
    expect(toDateInputValue('')).toBe('')
    expect(toDateInputValue('1800-01-01')).toBe('')
    expect(toDateInputValue('2200-01-01')).toBe('')
  })

  it('formats parsed datetimes', () => {
    expect(toDateInputValue('2026-06-17T00:00:00.000Z')).toMatch(/^2026-06-1[67]$/)
  })
})

describe('formatDate', () => {
  it('includes year when not the current year', () => {
    expect(formatDate('2020-01-15')).toContain('2020')
  })

  it('returns empty for missing values', () => {
    expect(formatDate(null)).toBe('')
  })
})

describe('isOverdue', () => {
  it('is false when completed or no due date', () => {
    expect(isOverdue(null, null)).toBe(false)
    expect(isOverdue('2099-01-01', '2026-01-01')).toBe(false)
  })

  it('is true when due date is in the past and not completed', () => {
    expect(isOverdue('2020-01-01', null)).toBe(true)
  })
})

describe('calendar helpers', () => {
  it('toDateKey formats local dates', () => {
    expect(toDateKey(new Date(2026, 5, 7))).toBe('2026-06-07')
  })

  it('addDays moves across month boundaries', () => {
    const start = new Date(2026, 5, 30)
    expect(toDateKey(addDays(start, 2))).toBe('2026-07-02')
  })

  it('startOfWeek returns Sunday', () => {
    const wed = new Date(2026, 5, 17)
    expect(startOfWeek(wed).getDay()).toBe(0)
  })
})

describe('formatDuration', () => {
  it('formats hours and minutes', () => {
    expect(formatDuration(3661)).toBe('1h 1m')
  })

  it('formats seconds only', () => {
    expect(formatDuration(45)).toBe('45s')
  })

  it('formats days when duration spans multiple days', () => {
    expect(formatDuration(90061)).toBe('1d 1h 1m')
  })

  it('includes seconds when under an hour', () => {
    expect(formatDuration(65)).toBe('1m 5s')
  })
})

describe('combineDurationParts / splitDurationParts', () => {
  it('round-trips day/hour/min/sec', () => {
    const total = combineDurationParts({ days: 1, hours: 2, minutes: 3, seconds: 4 })
    expect(total).toBe(93784)
    expect(splitDurationParts(total)).toEqual({ days: 1, hours: 2, minutes: 3, seconds: 4 })
  })
})

describe('formatTimer', () => {
  it('zero-pads timer segments', () => {
    expect(formatTimer(3661)).toBe('01:01:01')
  })

  it('includes days for multi-day timers', () => {
    expect(formatTimer(90061)).toBe('1:01:01:01')
  })
})

describe('mentions', () => {
  it('renders mention markup as plain @Name', () => {
    const body = 'Hi @[Alice Smith](11111111-1111-1111-1111-111111111111)'
    expect(renderMentions(body)).toBe('Hi @Alice Smith')
  })

  it('converts @Name to backend markup', () => {
    const map = new Map([['Alice', '11111111-1111-1111-1111-111111111111']])
    expect(toMentionMarkup('Hi @Alice', map)).toBe(
      'Hi @[Alice](11111111-1111-1111-1111-111111111111)',
    )
  })
})

describe('timezone helpers', () => {
  it('normalizes common abbreviations', () => {
    expect(normalizeTimezone('IST')).toBe('Asia/Kolkata')
    expect(normalizeTimezone('America/Chicago')).toBe('America/Chicago')
  })

  it('formats date/time in a timezone', () => {
    const iso = '2026-01-15T10:30:00.000Z'
    expect(formatDateTimeInTimezone(iso, 'UTC')).toContain('Jan')
    expect(formatHourInTimezone(iso, 'UTC')).toMatch(/^\d{2}$/)
  })

  it('labels IST distinctly', () => {
    expect(formatTimezoneLabel('IST')).toBe('IST')
    expect(formatTimezoneLabel('UTC')).toBe('UTC')
  })
})
