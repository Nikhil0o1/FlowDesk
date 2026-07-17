import { beforeEach, describe, expect, it, vi } from 'vitest'

import { api } from '@/lib/api'
import {
  heartbeatPresenceStatus,
  isBusyStatusText,
  usePresencePreferenceStore,
} from '@/lib/presence'

vi.mock('@/lib/api', () => ({
  api: { post: vi.fn().mockResolvedValue({}) },
}))

describe('presence helpers', () => {
  beforeEach(() => {
    usePresencePreferenceStore.setState({ manualBusy: false })
    vi.mocked(api.post).mockClear()
    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      value: 'visible',
    })
  })

  it('detects busy profile labels', () => {
    expect(isBusyStatusText('Busy')).toBe(true)
    expect(isBusyStatusText('In a meeting')).toBe(true)
    expect(isBusyStatusText('Available')).toBe(false)
  })

  it('sends busy heartbeat when manual busy is set', () => {
    usePresencePreferenceStore.setState({ manualBusy: true })
    expect(heartbeatPresenceStatus()).toBe('busy')
  })

  it('uses away when tab is hidden and not manually busy', () => {
    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      value: 'hidden',
    })
    expect(heartbeatPresenceStatus()).toBe('away')
  })

  it('syncs profile status to presence API when busy changes', async () => {
    await usePresencePreferenceStore.getState().applyFromProfileStatus('Focusing')
    expect(usePresencePreferenceStore.getState().manualBusy).toBe(true)
    expect(api.post).toHaveBeenCalledWith('/presence/status', { status: 'busy' })
  })
})
