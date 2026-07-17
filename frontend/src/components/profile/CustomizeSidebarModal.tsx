import { useEffect, useState } from 'react'

import { cn } from '../../lib/utils'
import { Modal } from '../ui/Modal'
import { HomeCustomization } from './HomeCustomization'
import { NavigationSettings } from './NavigationSettings'
import { SectionsSettings } from './SectionsSettings'
import { ThemeSettings } from './ThemeSettings'

export type CustomizeTab = 'navigation' | 'home' | 'sections' | 'themes'

interface Props {
  open: boolean
  onClose: () => void
  /** Tab to show when the dialog opens (defaults to Navigation). */
  initialTab?: CustomizeTab
}

const TABS: { key: CustomizeTab; label: string }[] = [
  { key: 'navigation', label: 'Navigation' },
  { key: 'home', label: 'Home' },
  { key: 'sections', label: 'Sections' },
  { key: 'themes', label: 'Themes' },
]

/** ClickUp-style "Customize Sidebar" dialog, opened from the sidebar footer. */
export function CustomizeSidebarModal({ open, onClose, initialTab = 'navigation' }: Props) {
  const [tab, setTab] = useState<CustomizeTab>(initialTab)

  // Jump to the requested tab each time the dialog is (re)opened.
  useEffect(() => {
    if (open) setTab(initialTab)
  }, [open, initialTab])

  return (
    <Modal open={open} onClose={onClose} title="Customize Sidebar" width="max-w-md">
      <div className="-mt-1 mb-4 flex gap-1 rounded-lg bg-ink-800 p-1">
        {TABS.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={cn(
              'flex-1 rounded-md px-3 py-1.5 text-sm font-medium transition-colors',
              tab === t.key
                ? 'bg-ink-700 text-fg shadow-sm'
                : 'text-fg-muted hover:text-fg-secondary',
            )}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'navigation' && <NavigationSettings />}
      {tab === 'home' && <HomeCustomization />}
      {tab === 'sections' && <SectionsSettings />}
      {tab === 'themes' && <ThemeSettings />}
    </Modal>
  )
}
