// Regression test: renders the chart with a real production payload shape
// (UUID series keys, mostly-zero trend with a late spike) and asserts the
// area paths actually draw.
import { render } from '@testing-library/react'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

import { TeamProductivityChart } from '../../../../src/components/dashboard/TeamProductivityChart'

const SERIES = [
  { key: '00000000-0000-4000-8000-0000000000a1', team_id: '00000000-0000-4000-8000-0000000000a1', name: 'Team FlowDesk', color: '#2B88EE' },
  { key: '00000000-0000-4000-8000-0000000000a2', team_id: '00000000-0000-4000-8000-0000000000a2', name: 'Team FlowDesk', color: '#2B88EE' },
  { key: '00000000-0000-4000-8000-0000000000a3', team_id: '00000000-0000-4000-8000-0000000000a3', name: 'Design', color: '#4CB782' },
]

const DAYS: Array<[string, string, number, number, number]> = [
  ['2026-07-02', 'Jul 2', 0, 0, 0],
  ['2026-07-03', 'Jul 3', 0, 0, 0],
  ['2026-07-04', 'Jul 4', 0, 0, 0],
  ['2026-07-05', 'Jul 5', 0, 0, 0],
  ['2026-07-06', 'Jul 6', 0, 0, 0],
  ['2026-07-07', 'Jul 7', 4, 4, 0],
  ['2026-07-08', 'Jul 8', 12, 11, 4],
]

const TREND = DAYS.map(([day, label, a, b, c]) => ({
  day,
  label,
  counts: {
    '00000000-0000-4000-8000-0000000000a1': a,
    '00000000-0000-4000-8000-0000000000a2': b,
    '00000000-0000-4000-8000-0000000000a3': c,
  },
}))

const SUMMARY = {
  total_completed: 35,
  previous_period_total: 0,
  active_teams: 3,
  leading_team_name: 'Team FlowDesk',
  leading_team_count: 16,
  display_mode: 'team' as const,
  total_teams: 3,
  total_entities: 3,
  featured_count: 3,
  other_entities_count: 0,
}

const PATCHED = ['clientWidth', 'clientHeight', 'offsetWidth', 'offsetHeight', 'getBoundingClientRect'] as const
const originals = new Map<string, PropertyDescriptor | undefined>()

beforeAll(() => {
  // jsdom has no layout: give ResponsiveContainer a real size. The vitest pool
  // runs every file in one fork, so restore these in afterAll.
  for (const prop of PATCHED) originals.set(prop, Object.getOwnPropertyDescriptor(HTMLElement.prototype, prop))
  Object.defineProperty(HTMLElement.prototype, 'clientWidth', { configurable: true, value: 480 })
  Object.defineProperty(HTMLElement.prototype, 'clientHeight', { configurable: true, value: 160 })
  Object.defineProperty(HTMLElement.prototype, 'offsetWidth', { configurable: true, value: 480 })
  Object.defineProperty(HTMLElement.prototype, 'offsetHeight', { configurable: true, value: 160 })
  Object.defineProperty(HTMLElement.prototype, 'getBoundingClientRect', {
    configurable: true,
    value: () => ({ width: 480, height: 160, top: 0, left: 0, right: 480, bottom: 160, x: 0, y: 0, toJSON: () => ({}) }),
  })
  vi.stubGlobal('ResizeObserver', class {
    cb: ResizeObserverCallback
    constructor(cb: ResizeObserverCallback) { this.cb = cb }
    observe(el: Element) {
      this.cb([{ target: el, contentRect: { width: 480, height: 160 } } as unknown as ResizeObserverEntry], this as unknown as ResizeObserver)
    }
    unobserve() {}
    disconnect() {}
  })
})

afterAll(() => {
  for (const prop of PATCHED) {
    const desc = originals.get(prop)
    if (desc) Object.defineProperty(HTMLElement.prototype, prop, desc)
    else delete (HTMLElement.prototype as unknown as Record<string, unknown>)[prop]
  }
  vi.unstubAllGlobals()
})

describe('TeamProductivityChart repro with prod payload', () => {
  it('renders one area path per series with real geometry', async () => {
    const { container } = render(
      <TeamProductivityChart series={SERIES as never} trend={TREND as never} summary={SUMMARY as never} />,
    )
    // allow recharts animation frame setup
    await new Promise((r) => setTimeout(r, 50))
    const curves = container.querySelectorAll('.recharts-area-curve')
    const areas = container.querySelectorAll('.recharts-area')
    const paths = Array.from(curves).map((c) => c.getAttribute('d') ?? '')
    expect(areas.length).toBe(3)
    expect(paths.every((p) => p.length > 10)).toBe(true)
  })
})
