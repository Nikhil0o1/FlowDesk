import { act, renderHook } from '@testing-library/react'
import { MemoryRouter, Route, Routes, useSearchParams } from 'react-router-dom'
import { describe, expect, it } from 'vitest'

import { useQueryFlagModal } from '@/lib/useQueryFlagModal'

function Probe() {
  const modal = useQueryFlagModal()
  const [params] = useSearchParams()
  return (
    <div>
      <span data-testid="open">{String(modal.isOpen)}</span>
      <span data-testid="flag">{params.get('new') ?? ''}</span>
      <button type="button" onClick={modal.open}>
        open
      </button>
      <button type="button" onClick={modal.close}>
        close
      </button>
    </div>
  )
}

function wrapper(initialEntry = '/page') {
  return ({ children }: { children: React.ReactNode }) => (
    <MemoryRouter initialEntries={[initialEntry]}>
      <Routes>
        <Route path="/page" element={children ?? <Probe />} />
      </Routes>
    </MemoryRouter>
  )
}

describe('useQueryFlagModal', () => {
  it('is closed by default', () => {
    const { result } = renderHook(() => useQueryFlagModal(), { wrapper: wrapper() })
    expect(result.current.isOpen).toBe(false)
  })

  it('is open when query flag matches', () => {
    const { result } = renderHook(() => useQueryFlagModal(), {
      wrapper: wrapper('/page?new=1'),
    })
    expect(result.current.isOpen).toBe(true)
  })

  it('open sets the query flag with replace', () => {
    const { result } = renderHook(
      () => ({
        modal: useQueryFlagModal(),
        params: useSearchParams()[0],
      }),
      { wrapper: wrapper('/page?tab=tasks') },
    )
    act(() => {
      result.current.modal.open()
    })
    expect(result.current.params.get('new')).toBe('1')
    expect(result.current.params.get('tab')).toBe('tasks')
  })

  it('close removes the query flag', () => {
    const { result } = renderHook(
      () => ({
        modal: useQueryFlagModal(),
        params: useSearchParams()[0],
      }),
      { wrapper: wrapper('/page?new=1&tab=tasks') },
    )
    act(() => {
      result.current.modal.close()
    })
    expect(result.current.params.get('new')).toBeNull()
    expect(result.current.params.get('tab')).toBe('tasks')
  })

  it('supports custom flag and value', () => {
    const { result } = renderHook(() => useQueryFlagModal('edit', 'true'), {
      wrapper: wrapper('/page?edit=true'),
    })
    expect(result.current.isOpen).toBe(true)
  })
})
