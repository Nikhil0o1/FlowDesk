import { act, renderHook } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { useResetFormWhenOpen } from '@/lib/useResetFormWhenOpen'

describe('useResetFormWhenOpen', () => {
  it('resets when the modal opens', () => {
    const reset = vi.fn()
    const { rerender } = renderHook(
      ({ open }) => useResetFormWhenOpen(open, reset),
      { initialProps: { open: false } },
    )

    expect(reset).not.toHaveBeenCalled()

    act(() => {
      rerender({ open: true })
    })
    expect(reset).toHaveBeenCalledTimes(1)

    act(() => {
      rerender({ open: false })
    })
    expect(reset).toHaveBeenCalledTimes(1)

    act(() => {
      rerender({ open: true })
    })
    expect(reset).toHaveBeenCalledTimes(2)
  })
})
