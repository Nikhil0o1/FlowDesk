import { describe, expect, it } from 'vitest'

import {
  SECONDARY_SIDEBAR_DEFAULT_WIDTH,
  SECONDARY_SIDEBAR_MAX_WIDTH,
  SECONDARY_SIDEBAR_MIN_WIDTH,
  clampSecondarySidebarWidth,
} from '@/lib/sidebarLayout'

describe('sidebarLayout', () => {
  it('exposes default and bounds', () => {
    expect(SECONDARY_SIDEBAR_DEFAULT_WIDTH).toBe(256)
    expect(SECONDARY_SIDEBAR_MIN_WIDTH).toBe(200)
    expect(SECONDARY_SIDEBAR_MAX_WIDTH).toBe(480)
  })

  it('clamps width within bounds', () => {
    expect(clampSecondarySidebarWidth(100)).toBe(200)
    expect(clampSecondarySidebarWidth(300)).toBe(300)
    expect(clampSecondarySidebarWidth(999)).toBe(480)
  })
})
