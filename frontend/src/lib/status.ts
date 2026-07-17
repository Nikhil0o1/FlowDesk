// User custom status — Slack-style "emoji + text", stored in profile.status_text
// as "<emoji> <text>" so no separate column is needed. Presence (online dot) is
// tracked separately and is NOT the same thing as a custom status.

export interface StatusPreset {
  emoji: string
  label: string
}

export const STATUS_PRESETS: StatusPreset[] = [
  { emoji: '🟢', label: 'Available' },
  { emoji: '🔴', label: 'Busy' },
  { emoji: '📅', label: 'In a meeting' },
  { emoji: '🎯', label: 'Focusing' },
  { emoji: '🍽️', label: 'Out for lunch' },
  { emoji: '🏠', label: 'Working remotely' },
  { emoji: '🌴', label: 'On leave' },
  { emoji: '🤒', label: 'Out sick' },
  { emoji: '✈️', label: 'Traveling' },
  { emoji: '💬', label: 'Available to chat' },
]

const LEADING_EMOJI_RE = /^(\p{Extended_Pictographic}(?:‍\p{Extended_Pictographic}|️)*)\s*/u

export function parseStatus(status: string | null | undefined): { emoji: string; text: string } {
  const value = (status ?? '').trim()
  if (!value) return { emoji: '', text: '' }
  const m = value.match(LEADING_EMOJI_RE)
  if (m) return { emoji: m[1], text: value.slice(m[0].length).trim() }
  return { emoji: '', text: value }
}

export function statusEmoji(status: string | null | undefined): string {
  return parseStatus(status).emoji
}

export function buildStatus(emoji: string, text: string): string {
  return [emoji.trim(), text.trim()].filter(Boolean).join(' ')
}
