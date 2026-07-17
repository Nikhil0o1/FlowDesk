import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { toast, useToastStore } from '@/stores/toast'

describe('useToastStore', () => {
  beforeEach(() => {
    useToastStore.setState({ toasts: [] })
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('push adds a toast with incrementing ids', () => {
    useToastStore.getState().push('success', 'Saved')
    useToastStore.getState().push('error', 'Failed')
    const toasts = useToastStore.getState().toasts
    expect(toasts).toHaveLength(2)
    expect(toasts[0]).toMatchObject({ kind: 'success', message: 'Saved' })
    expect(toasts[1].id).toBeGreaterThan(toasts[0].id)
  })

  it('dismiss removes a toast by id', () => {
    useToastStore.getState().push('info', 'Hello')
    const id = useToastStore.getState().toasts[0].id
    useToastStore.getState().dismiss(id)
    expect(useToastStore.getState().toasts).toHaveLength(0)
  })

  it('auto-dismisses toasts after timeout', () => {
    useToastStore.getState().push('success', 'Done')
    expect(useToastStore.getState().toasts).toHaveLength(1)
    vi.advanceTimersByTime(4200)
    expect(useToastStore.getState().toasts).toHaveLength(0)
  })
})

describe('toast helpers', () => {
  beforeEach(() => {
    useToastStore.setState({ toasts: [] })
  })

  it('success, error, and info delegate to push', () => {
    toast.success('ok')
    toast.error('bad')
    toast.info('note')
    const kinds = useToastStore.getState().toasts.map((t) => t.kind)
    expect(kinds).toEqual(['success', 'error', 'info'])
  })
})
