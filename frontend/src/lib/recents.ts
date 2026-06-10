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

export function recordRecent(item: Omit<RecentItem, 'ts'>): void {
  try {
    const list = getRecents().filter((r) => !(r.type === item.type && r.id === item.id))
    list.unshift({ ...item, ts: Date.now() })
    localStorage.setItem(KEY, JSON.stringify(list.slice(0, MAX)))
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
