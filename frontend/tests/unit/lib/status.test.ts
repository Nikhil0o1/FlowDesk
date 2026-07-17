import { describe, expect, it } from 'vitest'

import { buildStatus, parseStatus, statusEmoji, STATUS_PRESETS } from '@/lib/status'

describe('status helpers', () => {
  it('parses emoji-prefixed status text', () => {
    expect(parseStatus('🟢 Available')).toEqual({ emoji: '🟢', text: 'Available' })
    expect(parseStatus('plain text')).toEqual({ emoji: '', text: 'plain text' })
    expect(parseStatus(null)).toEqual({ emoji: '', text: '' })
  })

  it('builds and reads status emoji', () => {
    expect(buildStatus('🔴', 'Busy')).toBe('🔴 Busy')
    expect(buildStatus('', 'No emoji')).toBe('No emoji')
    expect(statusEmoji('🎯 Focusing')).toBe('🎯')
  })

  it('exposes preset list', () => {
    expect(STATUS_PRESETS.length).toBeGreaterThan(0)
    expect(STATUS_PRESETS[0]).toHaveProperty('emoji')
    expect(STATUS_PRESETS[0]).toHaveProperty('label')
  })
})
