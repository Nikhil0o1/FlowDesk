import { useMemo, useState } from 'react'

/** Compact, dependency-free emoji picker (native glyphs, search, recents). */

type EmojiEntry = [emoji: string, name: string]

const CATEGORIES: { key: string; label: string; emojis: EmojiEntry[] }[] = [
  {
    key: 'smileys',
    label: 'Smileys',
    emojis: [
      ['😀', 'grinning'], ['😄', 'smile'], ['😁', 'beaming'], ['😆', 'laughing'], ['😅', 'sweat smile'],
      ['😂', 'joy tears'], ['🤣', 'rofl'], ['🙂', 'slight smile'], ['😉', 'wink'], ['😊', 'blush'],
      ['😇', 'innocent'], ['🥰', 'hearts face'], ['😍', 'heart eyes'], ['🤩', 'star struck'], ['😘', 'kiss'],
      ['😋', 'yum'], ['😜', 'winking tongue'], ['🤪', 'zany'], ['🤗', 'hug'], ['🤔', 'thinking'],
      ['🤨', 'raised eyebrow'], ['😐', 'neutral'], ['😑', 'expressionless'], ['🙄', 'eye roll'], ['😏', 'smirk'],
      ['😴', 'sleeping'], ['🤒', 'sick'], ['🤯', 'mind blown'], ['🥳', 'party face'], ['😎', 'cool'],
      ['🤓', 'nerd'], ['😕', 'confused'], ['🙁', 'frown'], ['😢', 'cry'], ['😭', 'sob'],
      ['😤', 'triumph'], ['😠', 'angry'], ['🤬', 'cursing'], ['😱', 'scream'], ['😳', 'flushed'],
      ['🥺', 'pleading'], ['😬', 'grimace'], ['😮', 'open mouth'], ['🤫', 'shushing'], ['🤭', 'giggle'],
    ],
  },
  {
    key: 'gestures',
    label: 'Gestures',
    emojis: [
      ['👍', 'thumbs up'], ['👎', 'thumbs down'], ['👌', 'ok hand'], ['✌️', 'victory'], ['🤞', 'fingers crossed'],
      ['🤟', 'love you'], ['🤘', 'rock on'], ['👏', 'clap'], ['🙌', 'raised hands'], ['👐', 'open hands'],
      ['🤝', 'handshake'], ['🙏', 'please thanks pray'], ['💪', 'strong'], ['👋', 'wave'], ['🤙', 'call me'],
      ['✋', 'raised hand'], ['🖐️', 'hand splayed'], ['👉', 'point right'], ['👈', 'point left'], ['👆', 'point up'],
      ['👇', 'point down'], ['✍️', 'writing'], ['🫡', 'salute'], ['🫶', 'heart hands'],
    ],
  },
  {
    key: 'hearts',
    label: 'Hearts',
    emojis: [
      ['❤️', 'red heart'], ['🧡', 'orange heart'], ['💛', 'yellow heart'], ['💚', 'green heart'], ['💙', 'blue heart'],
      ['💜', 'purple heart'], ['🖤', 'black heart'], ['🤍', 'white heart'], ['🤎', 'brown heart'], ['💔', 'broken heart'],
      ['💕', 'two hearts'], ['💖', 'sparkling heart'], ['💗', 'growing heart'], ['💯', 'hundred'], ['💥', 'boom'],
    ],
  },
  {
    key: 'celebrate',
    label: 'Celebrate',
    emojis: [
      ['🎉', 'party popper'], ['🎊', 'confetti'], ['🥂', 'cheers'], ['🍾', 'champagne'], ['🎂', 'birthday cake'],
      ['🎁', 'gift'], ['🏆', 'trophy'], ['🥇', 'gold medal'], ['⭐', 'star'], ['🌟', 'glowing star'],
      ['✨', 'sparkles'], ['🔥', 'fire'], ['🚀', 'rocket'], ['💫', 'dizzy star'], ['🎯', 'bullseye'],
    ],
  },
  {
    key: 'work',
    label: 'Work',
    emojis: [
      ['✅', 'check done'], ['❌', 'cross no'], ['⚠️', 'warning'], ['❓', 'question'], ['❗', 'exclamation'],
      ['💡', 'idea bulb'], ['📌', 'pin'], ['📎', 'paperclip'], ['📝', 'memo note'], ['📄', 'document'],
      ['📁', 'folder'], ['📅', 'calendar'], ['⏰', 'alarm clock'], ['⏳', 'hourglass'], ['🔔', 'bell'],
      ['🔒', 'locked'], ['🔑', 'key'], ['🔍', 'search'], ['📈', 'chart up'], ['📉', 'chart down'],
      ['📊', 'bar chart'], ['💻', 'laptop'], ['🖥️', 'desktop'], ['📱', 'phone'], ['✉️', 'email'],
      ['🐛', 'bug'], ['🛠️', 'tools'], ['⚙️', 'gear'], ['🧠', 'brain'], ['☕', 'coffee'],
      ['🍕', 'pizza'], ['🌮', 'taco'], ['🍩', 'donut'], ['🎧', 'headphones'], ['🏃', 'running'],
    ],
  },
]

const RECENTS_KEY = 'flowdesk-emoji-recents'
const MAX_RECENTS = 16

function loadRecents(): string[] {
  try {
    const raw = localStorage.getItem(RECENTS_KEY)
    const parsed = raw ? (JSON.parse(raw) as string[]) : []
    return Array.isArray(parsed) ? parsed.slice(0, MAX_RECENTS) : []
  } catch {
    return []
  }
}

function saveRecent(emoji: string) {
  const next = [emoji, ...loadRecents().filter((e) => e !== emoji)].slice(0, MAX_RECENTS)
  localStorage.setItem(RECENTS_KEY, JSON.stringify(next))
}

export function EmojiPicker({ onPick }: { onPick: (emoji: string) => void }) {
  const [query, setQuery] = useState('')
  const [recents] = useState(loadRecents)

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return null
    return CATEGORIES.flatMap((c) => c.emojis).filter(([, name]) => name.includes(q))
  }, [query])

  const pick = (emoji: string) => {
    saveRecent(emoji)
    onPick(emoji)
  }

  const grid = (emojis: EmojiEntry[]) => (
    <div className="grid grid-cols-8 gap-0.5">
      {emojis.map(([emoji, name]) => (
        <button
          key={`${emoji}-${name}`}
          type="button"
          title={name}
          aria-label={name}
          onMouseDown={(e) => {
            e.preventDefault()
            pick(emoji)
          }}
          className="flex h-8 w-8 items-center justify-center rounded-lg text-lg transition-colors hover:bg-ink-750"
        >
          {emoji}
        </button>
      ))}
    </div>
  )

  return (
    <div className="flex max-h-80 w-72 flex-col">
      <input
        autoFocus
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Search emoji…"
        aria-label="Search emoji"
        className="input-dark mb-2 w-full !py-1.5 text-xs"
      />
      <div className="min-h-0 flex-1 space-y-2 overflow-y-auto pr-1">
        {filtered ? (
          filtered.length > 0 ? (
            grid(filtered)
          ) : (
            <p className="py-4 text-center text-xs text-fg-muted">No emoji found.</p>
          )
        ) : (
          <>
            {recents.length > 0 && (
              <div>
                <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-fg-muted">
                  Recently used
                </p>
                {grid(
                  recents.map((emoji) => {
                    const entry = CATEGORIES.flatMap((c) => c.emojis).find(([e]) => e === emoji)
                    return [emoji, entry?.[1] ?? emoji] as EmojiEntry
                  }),
                )}
              </div>
            )}
            {CATEGORIES.map((category) => (
              <div key={category.key}>
                <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-fg-muted">
                  {category.label}
                </p>
                {grid(category.emojis)}
              </div>
            ))}
          </>
        )}
      </div>
    </div>
  )
}
