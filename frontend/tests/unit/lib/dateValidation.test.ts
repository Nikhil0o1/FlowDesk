import { describe, expect, it } from 'vitest'

import { minEndDateKey, minSelectableDateKey, todayDateKey } from '@/lib/utils'

describe('date validation helpers', () => {
  it('minSelectableDateKey defaults to today', () => {
    expect(minSelectableDateKey()).toBe(todayDateKey())
  })

  it('minSelectableDateKey preserves an existing past value when editing', () => {
    expect(minSelectableDateKey('2020-01-01')).toBe('2020-01-01')
  })

  it('minEndDateKey respects start date and today', () => {
    const today = todayDateKey()
    expect(minEndDateKey(today)).toBe(today)
    expect(minEndDateKey('2099-06-01')).toBe('2099-06-01')
  })
})
