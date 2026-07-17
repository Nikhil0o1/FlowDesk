import { describe, expect, it } from 'vitest'

import { nextContentStamp, shouldApplyRemoteContent } from '../../../../src/modules/docs/lib/docCollab'

describe('docCollab timestamp LWW', () => {
  it('applies newer remote timestamps', () => {
    expect(shouldApplyRemoteContent({ version: 100, userId: 'a' }, 200, 'b')).toBe(true)
    expect(shouldApplyRemoteContent({ version: 200, userId: 'a' }, 100, 'b')).toBe(false)
  })

  it('does not drop equal versions when the remote actor wins the tie-break', () => {
    // Old counter-LWW would drop equal versions — both clients stuck out of sync.
    expect(shouldApplyRemoteContent({ version: 50, userId: 'aaa' }, 50, 'bbb')).toBe(true)
    expect(shouldApplyRemoteContent({ version: 50, userId: 'bbb' }, 50, 'aaa')).toBe(false)
  })

  it('rejects missing / invalid remote versions', () => {
    expect(shouldApplyRemoteContent({ version: 10, userId: 'a' }, undefined)).toBe(false)
    expect(shouldApplyRemoteContent({ version: 10, userId: 'a' }, Number.NaN)).toBe(false)
  })

  it('advances stamp without going backwards', () => {
    const now = Date.now()
    expect(nextContentStamp(now + 5_000)).toBe(now + 5_001)
    expect(nextContentStamp(0)).toBeGreaterThanOrEqual(now)
  })
})
