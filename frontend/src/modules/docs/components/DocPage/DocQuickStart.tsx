import { AtSign, BookOpen, FileText } from 'lucide-react'

import { cn } from '../../../../lib/utils'

interface DocQuickStartProps {
  onStartWriting: () => void
  onBlankWiki?: () => void
  onMention?: () => void
  readOnly?: boolean
  hasContent: boolean
}

/** Blank-page quick actions shown before the user starts writing. */
export function DocQuickStart({
  onStartWriting,
  onBlankWiki,
  onMention,
  readOnly,
  hasContent,
}: DocQuickStartProps) {
  if (hasContent || readOnly) return null

  const items: {
    id: string
    label: string
    icon: typeof FileText
    onClick: () => void
  }[] = [
    { id: 'write', label: 'Start writing', icon: FileText, onClick: onStartWriting },
    { id: 'wiki', label: 'Blank wiki', icon: BookOpen, onClick: onBlankWiki ?? onStartWriting },
    { id: 'mention', label: 'Mention (@people, tasks, docs…)', icon: AtSign, onClick: onMention ?? onStartWriting },
  ]

  return (
    <div className="mt-4 space-y-1">
      {items.map(({ id, label, icon: Icon, onClick }) => (
        <button
          key={id}
          type="button"
          onClick={onClick}
          className={cn(
            'flex w-full items-center gap-2.5 rounded-lg px-2 py-2 text-left text-sm transition-colors hover:bg-ink-800',
            'text-fg-secondary hover:text-fg',
          )}
        >
          <Icon size={16} className={id === 'mention' ? 'text-brand' : 'text-fg-muted'} />
          {label}
        </button>
      ))}
    </div>
  )
}
