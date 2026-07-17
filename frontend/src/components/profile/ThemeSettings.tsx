import { Check, Monitor, Moon, Sun } from 'lucide-react'

import { ACCENTS } from '../../lib/accents'
import { cn } from '../../lib/utils'
import { useUIStore, type ThemeMode } from '../../stores/ui'

/** A tiny mock of the app chrome (sidebar + content) used inside the appearance
 * preview cards. The accent square/bar reads the live `--brand` variable so the
 * preview reflects the currently-selected accent. */
function MiniUI({ dark }: { dark: boolean }) {
  const surface = dark ? '#272B34' : '#FFFFFF'
  const panel = dark ? '#333944' : '#EEF1F5'
  const line = dark ? '#49515F' : '#D7DCE3'
  return (
    <div className="flex h-full w-full" style={{ background: surface }}>
      <div className="flex h-full w-1/3 flex-col gap-1 p-1.5" style={{ background: panel }}>
        <div className="h-2 w-2 rounded" style={{ background: 'var(--brand)' }} />
        <div className="h-1 w-full rounded-full" style={{ background: line }} />
        <div className="h-1 w-3/4 rounded-full" style={{ background: line }} />
        <div className="h-1 w-2/3 rounded-full" style={{ background: line }} />
      </div>
      <div className="flex h-full flex-1 flex-col gap-1 p-1.5">
        <div className="h-1.5 w-1/2 rounded-full" style={{ background: 'var(--brand)' }} />
        <div className="h-1 w-full rounded-full" style={{ background: line }} />
        <div className="h-1 w-5/6 rounded-full" style={{ background: line }} />
        <div className="h-1 w-2/3 rounded-full" style={{ background: line }} />
      </div>
    </div>
  )
}

function ThemePreview({ mode }: { mode: ThemeMode }) {
  if (mode === 'auto') {
    return (
      <div className="relative h-16 w-full overflow-hidden rounded-lg">
        <div className="absolute inset-0">
          <MiniUI dark={false} />
        </div>
        <div className="absolute inset-0" style={{ clipPath: 'polygon(100% 0, 100% 100%, 50% 100%, 50% 0)' }}>
          <MiniUI dark />
        </div>
      </div>
    )
  }
  return (
    <div className="h-16 w-full overflow-hidden rounded-lg">
      <MiniUI dark={mode === 'dark'} />
    </div>
  )
}

const APPEARANCE: { key: ThemeMode; label: string; icon: React.ReactNode }[] = [
  { key: 'light', label: 'Light', icon: <Sun size={13} /> },
  { key: 'dark', label: 'Dark', icon: <Moon size={13} /> },
  { key: 'auto', label: 'Auto', icon: <Monitor size={13} /> },
]

/**
 * Appearance (Light / Dark / Auto) + accent-color picker. State lives in
 * `useUIStore` and is applied globally as CSS variables + the `.dark` class in
 * `App.tsx`, so selections take effect instantly and persist across reloads.
 * Shared by the Topbar's Customize dialog and the Customize Sidebar → Themes tab.
 */
export function ThemeSettings() {
  const { theme, setTheme, accent, setAccent } = useUIStore()

  return (
    <div className="space-y-5">
      <section>
        <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-fg-muted">Appearance</h3>
        <div className="grid grid-cols-3 gap-2.5">
          {APPEARANCE.map((opt) => {
            const active = theme === opt.key
            return (
              <button
                key={opt.key}
                onClick={() => setTheme(opt.key)}
                className={cn(
                  'rounded-xl border p-1.5 text-left transition-colors',
                  active ? 'border-brand ring-1 ring-brand' : 'border-ink-700 hover:border-ink-600',
                )}
              >
                <ThemePreview mode={opt.key} />
                <div className="mt-1.5 flex items-center justify-center gap-1 text-xs">
                  <span className={active ? 'text-brand' : 'text-fg-muted'}>{opt.icon}</span>
                  <span className={cn('font-medium', active ? 'text-fg' : 'text-fg-secondary')}>
                    {opt.label}
                  </span>
                </div>
              </button>
            )
          })}
        </div>
      </section>

      <section>
        <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-fg-muted">Accent color</h3>
        <div className="grid grid-cols-3 gap-2">
          {ACCENTS.map((a) => {
            const active = accent === a.key
            return (
              <button
                key={a.key}
                onClick={() => setAccent(a.key)}
                className={cn(
                  'flex items-center gap-2 rounded-lg border px-2.5 py-2 text-left text-xs font-medium transition-colors',
                  active
                    ? 'border-brand bg-brand-soft text-fg'
                    : 'border-ink-700 text-fg-secondary hover:bg-ink-750 hover:text-fg',
                )}
              >
                <span className="h-3.5 w-3.5 shrink-0 rounded-full" style={{ background: a.brand }} />
                <span className="flex-1 truncate">{a.label}</span>
                {active && <Check size={13} className="shrink-0 text-brand" strokeWidth={3} />}
              </button>
            )
          })}
        </div>
      </section>
    </div>
  )
}
