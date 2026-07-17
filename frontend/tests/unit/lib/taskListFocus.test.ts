import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  clearOpenedTask,
  peekOpenedTask,
  rememberOpenedTask,
  scrollToTaskRow,
  taskRowSelector,
} from '@/lib/taskListFocus'

const STORAGE_KEY = 'flowdesk:last-opened-task'

describe('taskListFocus', () => {
  beforeEach(() => {
    sessionStorage.clear()
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
    document.body.innerHTML = ''
  })

  it('remembers and peeks the opened task id', () => {
    rememberOpenedTask('task-42')
    expect(peekOpenedTask()).toBe('task-42')
  })

  it('clears stored focus', () => {
    rememberOpenedTask('task-42')
    clearOpenedTask()
    expect(peekOpenedTask()).toBeNull()
  })

  it('ignores expired entries', () => {
    sessionStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ taskId: 'old-task', at: Date.now() - 3 * 60_000 }),
    )
    expect(peekOpenedTask()).toBeNull()
    expect(sessionStorage.getItem(STORAGE_KEY)).toBeNull()
  })

  it('drops malformed storage payloads', () => {
    sessionStorage.setItem(STORAGE_KEY, '{"bad":true}')
    expect(peekOpenedTask()).toBeNull()
  })

  it('escapes task ids in the row selector', () => {
    expect(taskRowSelector('a"b')).toBe('[data-task-id="a\\"b"]')
  })

  it('scrolls to and highlights a matching row', () => {
    const row = document.createElement('div')
    row.dataset.taskId = 'task-99'
    row.scrollIntoView = vi.fn()
    document.body.appendChild(row)

    expect(scrollToTaskRow('task-99')).toBe(true)
    expect(row.scrollIntoView).toHaveBeenCalledWith({
      block: 'center',
      inline: 'nearest',
      behavior: 'instant',
    })
    expect(row.classList.contains('ring-1')).toBe(true)

    vi.advanceTimersByTime(1600)
    expect(row.classList.contains('ring-1')).toBe(false)
  })

  it('returns false when the row is not in the DOM', () => {
    expect(scrollToTaskRow('missing')).toBe(false)
  })
})
