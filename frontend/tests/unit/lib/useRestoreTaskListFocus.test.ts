import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { rememberOpenedTask } from '@/lib/taskListFocus'
import { useRestoreTaskListFocus } from '@/lib/useRestoreTaskListFocus'

describe('useRestoreTaskListFocus', () => {
  beforeEach(() => {
    sessionStorage.clear()
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
    document.body.innerHTML = ''
  })

  it('does nothing when no task was remembered', () => {
    renderHook(() => useRestoreTaskListFocus(true))
    act(() => {
      vi.runAllTimers()
    })
    expect(sessionStorage.getItem('flowdesk:last-opened-task')).toBeNull()
  })

  it('does nothing while the list is not ready', () => {
    rememberOpenedTask('task-1')
    renderHook(() => useRestoreTaskListFocus(false))
    act(() => {
      vi.runAllTimers()
    })
    expect(sessionStorage.getItem('flowdesk:last-opened-task')).not.toBeNull()
  })

  it('scrolls to the remembered row and clears storage', () => {
    rememberOpenedTask('task-1')
    const row = document.createElement('div')
    row.dataset.taskId = 'task-1'
    row.scrollIntoView = vi.fn()
    document.body.appendChild(row)

    renderHook(() => useRestoreTaskListFocus(true))
    act(() => {
      vi.runAllTimers()
    })

    expect(row.scrollIntoView).toHaveBeenCalled()
    expect(sessionStorage.getItem('flowdesk:last-opened-task')).toBeNull()
  })

  it('retries until the row appears', () => {
    rememberOpenedTask('task-2')

    renderHook(() => useRestoreTaskListFocus(true))
    act(() => {
      vi.advanceTimersByTime(0)
    })

    const row = document.createElement('div')
    row.dataset.taskId = 'task-2'
    row.scrollIntoView = vi.fn()
    document.body.appendChild(row)

    act(() => {
      vi.advanceTimersByTime(50)
    })

    expect(row.scrollIntoView).toHaveBeenCalled()
    expect(sessionStorage.getItem('flowdesk:last-opened-task')).toBeNull()
  })
})
