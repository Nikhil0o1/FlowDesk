import { describe, expect, it } from 'vitest'

import {
  INBOX_FILTER_BY_INDEX,
  INBOX_TAB_BY_KEY,
  buildInboxShortcutCategories,
} from '@/lib/inboxShortcuts'

describe('inboxShortcuts', () => {
  it('builds shortcut categories with modifier key', () => {
    const categories = buildInboxShortcutCategories('Ctrl')
    expect(categories).toHaveLength(2)
    expect(categories[0].sections[0].items[0].keys).toEqual(['Ctrl', 'K'])
    expect(categories[1].sections[0].items[1].description).toContain('Primary')
  })

  it('maps filter and tab shortcut keys', () => {
    expect(INBOX_FILTER_BY_INDEX['1']).toBe('mentions')
    expect(INBOX_TAB_BY_KEY.p).toBe('primary')
    expect(INBOX_TAB_BY_KEY.c).toBe('cleared')
  })
})
