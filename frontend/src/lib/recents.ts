/** Recently-viewed items, tracked locally per browser (real usage data, no server round-trip). */

export interface RecentItem {
  type: 'task' | 'project'
  id: string
  label: string
  sublabel?: string
  ts: number
}

const KEY = 'flowdesk-recents'
const MAX = 10
export const RECENTS_UPDATED_EVENT = 'flowdesk-recents-updated'

function notifyRecentsUpdated(): void {
  window.dispatchEvent(new Event(RECENTS_UPDATED_EVENT))
}

export function recordRecent(item: Omit<RecentItem, 'ts'>): void {
  try {
    const list = getRecents().filter((r) => !(r.type === item.type && r.id === item.id))
    list.unshift({ ...item, ts: Date.now() })
    localStorage.setItem(KEY, JSON.stringify(list.slice(0, MAX)))
    notifyRecentsUpdated()
  } catch {
    /* storage unavailable */
  }
}

export function getRecents(): RecentItem[] {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? '[]') as RecentItem[]
  } catch {
    return []
  }
}

export function recentItemPath(item: RecentItem): string {
  return item.type === 'task' ? `/app/tasks/${item.id}` : `/app/projects/${item.id}`
}

export async function copyRecentItemLink(item: RecentItem): Promise<void> {
  const url = `${window.location.origin}${recentItemPath(item)}`
  await navigator.clipboard?.writeText(url)
}

export function removeRecent(type: RecentItem['type'], id: string): void {
  try {
    const list = getRecents().filter((r) => !(r.type === type && r.id === id))
    localStorage.setItem(KEY, JSON.stringify(list))
    notifyRecentsUpdated()
  } catch {
    /* storage unavailable */
  }
}
