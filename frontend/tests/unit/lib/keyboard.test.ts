import { afterEach, describe, expect, it, vi } from 'vitest'

import { modKeyLabel } from '@/lib/keyboard'

describe('modKeyLabel', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('returns Ctrl on non-Apple platforms', () => {
    vi.stubGlobal('navigator', { platform: 'Win32' })
    expect(modKeyLabel()).toBe('Ctrl')
  })

  it('returns command symbol on Mac', () => {
    vi.stubGlobal('navigator', { platform: 'MacIntel' })
    expect(modKeyLabel()).toBe('⌘')
  })
})
