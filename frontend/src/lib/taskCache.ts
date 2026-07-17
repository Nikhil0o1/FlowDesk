import type { QueryClient } from '@tanstack/react-query'

import type { Task } from './types'

/**
 * Query-key roots that hold task lists across the app. Optimistic updates and
 * reconciling invalidation walk all of them so a change shows everywhere at
 * once (board, table, list, sprint, backlog) with zero perceived latency.
 */
const LIST_ROOTS: readonly (readonly unknown[])[] = [
  ['tasks'], // project task lists — Page<Task>
  ['sprint-tasks'], // sprint board — Task[]
  ['backlog'], // sprint backlog — Task[]
  ['my-tasks'], // "My work" list — Page<Task>
]

/** Apply `fn` to a task inside one cached query value, whatever its shape. */
function mapList(data: any, taskId: string, fn: (t: Task) => Task): any {
  if (!data) return data
  if (Array.isArray(data)) {
    return data.map((t: Task) => (t && t.id === taskId ? fn(t) : t))
  }
  if (Array.isArray(data.items)) {
    return { ...data, items: data.items.map((t: Task) => (t.id === taskId ? fn(t) : t)) }
  }
  return data
}

/** Optimistically transform a task wherever it is cached (any list + detail). */
export function patchTaskInCaches(qc: QueryClient, taskId: string, fn: (t: Task) => Task) {
  for (const root of LIST_ROOTS) {
    qc.setQueriesData({ queryKey: root }, (data: any) => mapList(data, taskId, fn))
  }
  qc.setQueryData(['task', taskId], (d: any) => (d ? fn(d) : d))
}

/** Drop a task from one cached query value, whatever its shape. */
function dropFromList(data: any, taskId: string): any {
  if (!data) return data
  if (Array.isArray(data)) return data.filter((t: Task) => t?.id !== taskId)
  if (Array.isArray(data.items)) {
    const items = data.items.filter((t: Task) => t.id !== taskId)
    if (items.length === data.items.length) return data
    return { ...data, items, ...(typeof data.total === 'number' ? { total: data.total - 1 } : {}) }
  }
  return data
}

/** Optimistically remove a task from every cached list (delete UX: the row
 * disappears immediately; restore the snapshot if the API call fails). */
export function removeTaskFromCaches(qc: QueryClient, taskId: string) {
  for (const root of LIST_ROOTS) {
    qc.setQueriesData({ queryKey: root }, (data: any) => dropFromList(data, taskId))
  }
}

export type TaskCacheSnapshot = [readonly unknown[], unknown][]

/** Snapshot every task cache so an optimistic update can be rolled back. */
export function snapshotTaskCaches(qc: QueryClient): TaskCacheSnapshot {
  const snap: TaskCacheSnapshot = []
  for (const root of LIST_ROOTS) snap.push(...qc.getQueriesData({ queryKey: root }))
  snap.push(...qc.getQueriesData({ queryKey: ['task'] }))
  return snap
}

export function restoreTaskCaches(qc: QueryClient, snap: TaskCacheSnapshot) {
  for (const [key, data] of snap) qc.setQueryData(key, data)
}

/** Cancel in-flight task refetches so they can't clobber an optimistic update. */
export async function cancelTaskCaches(qc: QueryClient) {
  await Promise.all(LIST_ROOTS.map((root) => qc.cancelQueries({ queryKey: root })))
}

/** Background reconcile after a mutation settles. */
export function invalidateTaskCaches(qc: QueryClient, taskId?: string) {
  for (const root of LIST_ROOTS) void qc.invalidateQueries({ queryKey: root })
  if (taskId) void qc.invalidateQueries({ queryKey: ['task', taskId] })
  void qc.invalidateQueries({ queryKey: ['project-member-dashboard'] })
  void qc.invalidateQueries({ queryKey: ['project-dashboard'] })
  void qc.invalidateQueries({ queryKey: ['workspace-dashboard'] })
  void qc.invalidateQueries({ queryKey: ['space-dashboard'] })
}
