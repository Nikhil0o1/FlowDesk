const STORAGE_KEY = 'flowdesk:last-opened-task'
const HIGHLIGHT_MS = 1600
/** Ignore stale entries (user left task via Home instead of Back). */
const MAX_AGE_MS = 2 * 60_000

interface StoredFocus {
  taskId: string
  at: number
}

/** Persist the task the user just opened so the list can restore focus on back. */
export function rememberOpenedTask(taskId: string) {
  try {
    const payload: StoredFocus = { taskId, at: Date.now() }
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(payload))
  } catch {
    /* private mode / quota — ignore */
  }
}

function readStored(): StoredFocus | null {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as StoredFocus
    if (!parsed?.taskId || typeof parsed.at !== 'number') {
      sessionStorage.removeItem(STORAGE_KEY)
      return null
    }
    if (Date.now() - parsed.at > MAX_AGE_MS) {
      sessionStorage.removeItem(STORAGE_KEY)
      return null
    }
    return parsed
  } catch {
    try {
      sessionStorage.removeItem(STORAGE_KEY)
    } catch {
      /* ignore */
    }
    return null
  }
}

export function peekOpenedTask(): string | null {
  return readStored()?.taskId ?? null
}

export function clearOpenedTask() {
  try {
    sessionStorage.removeItem(STORAGE_KEY)
  } catch {
    /* ignore */
  }
}

export function taskRowSelector(taskId: string): string {
  return `[data-task-id="${CSS.escape(taskId)}"]`
}

/** Scroll the restored task into view and briefly highlight the row. */
export function scrollToTaskRow(taskId: string): boolean {
  const el = document.querySelector(taskRowSelector(taskId)) as HTMLElement | null
  if (!el) return false
  el.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'instant' as ScrollBehavior })
  el.classList.add('ring-1', 'ring-brand/60', 'bg-brand-soft/30')
  window.setTimeout(() => {
    el.classList.remove('ring-1', 'ring-brand/60', 'bg-brand-soft/30')
  }, HIGHLIGHT_MS)
  return true
}
