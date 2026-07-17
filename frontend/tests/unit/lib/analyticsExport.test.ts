import { beforeEach, describe, expect, it, vi } from 'vitest'

const save = vi.hoisted(() => vi.fn())
vi.mock('jspdf', () => ({
  jsPDF: vi.fn().mockImplementation(() => ({
    internal: { pageSize: { getWidth: () => 800, getHeight: () => 600 } },
    setFontSize: vi.fn(),
    setTextColor: vi.fn(),
    setFont: vi.fn(),
    setDrawColor: vi.fn(),
    text: vi.fn(),
    line: vi.fn(),
    addPage: vi.fn(),
    save,
  })),
}))

import { exportPresence, type ExportFormat } from '@/lib/analyticsExport'
import type { PresenceUserRow } from '@/lib/types'

function mockRow(overrides: Partial<PresenceUserRow> = {}): PresenceUserRow {
  return {
    user: { id: 'u1', email: 'alice@example.com', full_name: 'Alice Smith' },
    role: 'member',
    status: 'online',
    workspaces: ['WS'],
    teams: ['Team'],
    login_time: '2026-01-15T10:00:00.000Z',
    last_seen: '2026-01-15T11:00:00.000Z',
    session_duration: 3661,
    idle_time: 120,
    device: 'Desktop',
    browser: 'Chrome',
    ...overrides,
  }
}

describe('exportPresence', () => {
  beforeEach(() => {
    save.mockClear()
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:mock')
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {})
  })

  it.each<ExportFormat>(['csv', 'excel'])('downloads %s export', async (format) => {
    const click = vi.fn()
    const anchor = { href: '', download: '', click } as unknown as HTMLAnchorElement
    vi.spyOn(document, 'createElement').mockReturnValue(anchor)
    vi.spyOn(document.body, 'appendChild').mockImplementation(() => anchor)
    vi.spyOn(document.body, 'removeChild').mockImplementation(() => anchor)

    await exportPresence([mockRow()], format, 'presence-report')

    expect(click).toHaveBeenCalled()
    expect(anchor.download).toContain('presence-report')
  })

  it('generates pdf export', async () => {
    await exportPresence([mockRow({ session_duration: 45 })], 'pdf', 'presence-report')
    expect(save).toHaveBeenCalledWith(expect.stringContaining('presence-report'))
  })

  it('formats short session durations for tabular export', async () => {
    const click = vi.fn()
    const anchor = { href: '', download: '', click } as unknown as HTMLAnchorElement
    vi.spyOn(document, 'createElement').mockReturnValue(anchor)
    vi.spyOn(document.body, 'appendChild').mockImplementation(() => anchor)
    vi.spyOn(document.body, 'removeChild').mockImplementation(() => anchor)

    await exportPresence([mockRow({ session_duration: 45, idle_time: 5 })], 'csv')
    expect(click).toHaveBeenCalled()
  })
})
