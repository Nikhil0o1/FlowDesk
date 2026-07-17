/** Word / character / reading-time stats for a document body (HTML). */
export function computeDocStats(html: string): { words: number; chars: number; readingTimeSec: number } {
  const text = html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()
  const words = text ? text.split(' ').filter(Boolean).length : 0
  const chars = text.replace(/\s/g, '').length
  const readingTimeSec = words === 0 ? 0 : Math.max(1, Math.round((words / 200) * 60))
  return { words, chars, readingTimeSec }
}

export function formatReadingTime(seconds: number): string {
  if (seconds === 0) return '0s'
  if (seconds < 60) return `${seconds}s`
  const m = Math.floor(seconds / 60)
  const s = seconds % 60
  return s > 0 ? `${m}m ${s}s` : `${m}m`
}
