import { describe, expect, it, vi } from 'vitest'

import {
  RECENTS_UPDATED_EVENT,
  copyRecentItemLink,
  getRecents,
  recentItemPath,
  recordRecent,
  removeRecent,
} from '@/lib/recents'

describe('recents', () => {
  it('records and retrieves recent items newest-first', () => {
    recordRecent({ type: 'task', id: 't1', label: 'First' })
    recordRecent({ type: 'project', id: 'p1', label: 'Project' })
    const list = getRecents()
    expect(list[0].id).toBe('p1')
    expect(list[1].id).toBe('t1')
    expect(list[0].ts).toBeTypeOf('number')
  })

  it('deduplicates by type and id on re-record', () => {
    recordRecent({ type: 'task', id: 't1', label: 'Old label' })
    recordRecent({ type: 'task', id: 't2', label: 'Other' })
    recordRecent({ type: 'task', id: 't1', label: 'Updated' })
    const list = getRecents()
    expect(list).toHaveLength(2)
    expect(list[0]).toMatchObject({ id: 't1', label: 'Updated' })
  })

  it('caps the list at 10 items', () => {
    for (let i = 0; i < 12; i++) {
      recordRecent({ type: 'task', id: `t${i}`, label: `Task ${i}` })
    }
    expect(getRecents()).toHaveLength(10)
  })

  it('removes a specific recent item', () => {
    recordRecent({ type: 'task', id: 't1', label: 'Keep' })
    recordRecent({ type: 'task', id: 't2', label: 'Remove' })
    removeRecent('task', 't2')
    const ids = getRecents().map((r) => r.id)
    expect(ids).toEqual(['t1'])
  })

  it('dispatches RECENTS_UPDATED_EVENT on change', () => {
    const handler = vi.fn()
    window.addEventListener(RECENTS_UPDATED_EVENT, handler)
    recordRecent({ type: 'task', id: 't1', label: 'Test' })
    expect(handler).toHaveBeenCalled()
    window.removeEventListener(RECENTS_UPDATED_EVENT, handler)
  })

  it('returns empty list when storage is corrupt', () => {
    localStorage.setItem('flowdesk-recents', '{not json')
    expect(getRecents()).toEqual([])
  })

  it('builds paths and copies full links', async () => {
    const task = { type: 'task' as const, id: 't1', label: 'Task', ts: 1 }
    const project = { type: 'project' as const, id: 'p1', label: 'Project', ts: 1 }
    expect(recentItemPath(task)).toBe('/app/tasks/t1')
    expect(recentItemPath(project)).toBe('/app/projects/p1')

    const writeText = vi.fn().mockResolvedValue(undefined)
    vi.stubGlobal('navigator', { clipboard: { writeText } })
    await copyRecentItemLink(task)
    expect(writeText).toHaveBeenCalledWith(`${window.location.origin}/app/tasks/t1`)
  })
})
