import { Moon, Sun } from 'lucide-react'

import { cn } from '../../lib/utils'
import { useUIStore } from '../../stores/ui'

export function ThemeToggle({ className }: { className?: string }) {
  const theme = useUIStore((s) => s.theme)
  const toggleTheme = useUIStore((s) => s.toggleTheme)
  const label = theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'

  return (
    <button
      type="button"
      className={cn('btn-ghost !px-2', className)}
      title={label}
      aria-label={label}
      onClick={toggleTheme}
    >
      {theme === 'dark' ? <Sun size={17} strokeWidth={1.8} /> : <Moon size={17} strokeWidth={1.8} />}
    </button>
  )
}
