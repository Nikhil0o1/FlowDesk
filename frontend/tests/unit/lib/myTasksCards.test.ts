import { describe, expect, it } from 'vitest'

import {
  DEFAULT_MY_TASKS_VISIBLE_CARDS,
  MY_TASKS_CARD_IDS,
  normalizeMyTasksCards,
  sanitizeMyTasksCards,
} from '@/lib/myTasksCards'

describe('myTasksCards', () => {
  it('lists ClickUp-aligned default cards without lineup', () => {
    expect(MY_TASKS_CARD_IDS).toEqual([
      'recents',
      'agenda',
      'my_work',
      'assigned_comments',
      'personal_list',
      'assigned',
      'created',
    ])
    expect(DEFAULT_MY_TASKS_VISIBLE_CARDS).not.toContain('lineup')
  })

  it('strips legacy cards and restores recents at the front', () => {
    const normalized = normalizeMyTasksCards(['lineup', 'agenda', 'priorities'])
    expect(normalized).not.toContain('lineup')
    expect(normalized[0]).toBe('recents')
    expect(normalized).toContain('agenda')
    expect(normalized).toContain('assigned')
  })

  it('sanitize keeps user-hidden cards hidden', () => {
    const sanitized = sanitizeMyTasksCards(['recents', 'agenda', 'lineup'])
    expect(sanitized).toEqual(['recents', 'agenda'])
  })
})
