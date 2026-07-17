import { describe, expect, it } from 'vitest'

import {
  clampMyTasksCardColSpan,
  clampMyTasksCardHeight,
  colSpanFromPixelWidth,
  DEFAULT_MY_TASKS_CARD_SIZES,
} from '@/lib/myTasksCardLayout'

describe('myTasksCardLayout', () => {
  it('clamps height and column span', () => {
    expect(clampMyTasksCardHeight(50)).toBe(160)
    expect(clampMyTasksCardHeight(2000)).toBe(900)
    expect(clampMyTasksCardColSpan(3)).toBe(4)
    expect(clampMyTasksCardColSpan(13)).toBe(12)
  })

  it('defaults assigned card to full width', () => {
    expect(DEFAULT_MY_TASKS_CARD_SIZES.assigned.colSpan).toBe(12)
  })

  it('derives column span from pixel width', () => {
    expect(colSpanFromPixelWidth(600, 1200)).toBe(6)
    expect(colSpanFromPixelWidth(1200, 1200)).toBe(12)
  })
})
