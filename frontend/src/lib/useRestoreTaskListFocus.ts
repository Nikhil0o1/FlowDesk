import { useEffect, useRef } from 'react'

import { clearOpenedTask, peekOpenedTask, scrollToTaskRow } from './taskListFocus'

/**
 * After a list remounts (user opened a task then pressed Back), scroll to that
 * task row and briefly highlight it. Retries briefly while async data loads.
 * Only clears the saved id after a successful scroll (or when expired).
 */
export function useRestoreTaskListFocus(ready = true) {
  const done = useRef(false)

  useEffect(() => {
    if (!ready || done.current) return

    const taskId = peekOpenedTask()
    if (!taskId) {
      done.current = true
      return
    }

    let attempts = 0
    let timer: number | undefined

    const tryScroll = () => {
      attempts += 1
      if (scrollToTaskRow(taskId)) {
        clearOpenedTask()
        done.current = true
        return
      }
      if (attempts >= 24) {
        // Task not on this list — leave storage so the correct list can still restore.
        done.current = true
        return
      }
      timer = window.setTimeout(tryScroll, 50)
    }

    timer = window.setTimeout(tryScroll, 0)
    return () => {
      if (timer) window.clearTimeout(timer)
    }
  }, [ready])
}
