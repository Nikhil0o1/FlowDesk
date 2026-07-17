import {
  Bold,
  Code,
  Heading1,
  Heading2,
  Heading3,
  Heading4,
  Image as ImageIcon,
  Italic,
  Link as LinkIcon,
  List,
  ListChecks,
  ListOrdered,
  Minus,
  Pilcrow,
  Quote,
  Redo2,
  SquareCode,
  Strikethrough,
  Table as TableIcon,
  Underline,
  Undo2,
  type LucideIcon,
} from 'lucide-react'

import { cn } from '../../../../lib/utils'
import type { EditorApi } from '../../types/editor'

interface Tool {
  icon: LucideIcon
  label: string
  run: () => void
}

/**
 * Responsive formatting toolbar. Buttons use `onMouseDown → preventDefault` so
 * the editor keeps its selection when a control is clicked.
 */
export function DocToolbar({ api }: { api: EditorApi }) {
  const groups: Tool[][] = [
    [
      { icon: Undo2, label: 'Undo', run: api.undo },
      { icon: Redo2, label: 'Redo', run: api.redo },
    ],
    [
      { icon: Pilcrow, label: 'Paragraph', run: api.paragraph },
      { icon: Heading1, label: 'Heading 1', run: () => api.heading(1) },
      { icon: Heading2, label: 'Heading 2', run: () => api.heading(2) },
      { icon: Heading3, label: 'Heading 3', run: () => api.heading(3) },
      { icon: Heading4, label: 'Heading 4', run: () => api.heading(4) },
    ],
    [
      { icon: Bold, label: 'Bold', run: api.bold },
      { icon: Italic, label: 'Italic', run: api.italic },
      { icon: Underline, label: 'Underline', run: api.underline },
      { icon: Strikethrough, label: 'Strikethrough', run: api.strike },
    ],
    [
      { icon: List, label: 'Bullet list', run: api.bulletList },
      { icon: ListOrdered, label: 'Numbered list', run: api.numberList },
      { icon: ListChecks, label: 'Checklist', run: api.checklist },
    ],
    [
      { icon: Quote, label: 'Quote', run: api.quote },
      { icon: Code, label: 'Inline code', run: api.inlineCode },
      { icon: SquareCode, label: 'Code block', run: api.codeBlock },
    ],
    [
      { icon: LinkIcon, label: 'Link', run: api.link },
      { icon: ImageIcon, label: 'Image', run: api.image },
      { icon: TableIcon, label: 'Table', run: api.table },
      { icon: Minus, label: 'Divider', run: api.divider },
    ],
  ]

  return (
    <div
      role="toolbar"
      aria-label="Formatting"
      className="sticky top-0 z-10 flex flex-wrap items-center gap-0.5 border-b border-ink-700 bg-ink-900/95 px-2 py-1.5 backdrop-blur"
    >
      {groups.map((group, gi) => (
        <div key={gi} className="flex items-center gap-0.5">
          {gi > 0 && <span className="mx-1 h-5 w-px bg-ink-700" aria-hidden />}
          {group.map((tool) => (
            <ToolbarButton key={tool.label} tool={tool} />
          ))}
        </div>
      ))}
    </div>
  )
}

function ToolbarButton({ tool }: { tool: Tool }) {
  const Icon = tool.icon
  return (
    <button
      type="button"
      title={tool.label}
      aria-label={tool.label}
      onMouseDown={(e) => e.preventDefault()}
      onClick={tool.run}
      className={cn(
        'flex h-8 w-8 items-center justify-center rounded-md text-fg-secondary transition-colors',
        'hover:bg-ink-750 hover:text-fg focus:outline-none focus-visible:ring-2 focus-visible:ring-brand',
      )}
    >
      <Icon size={16} strokeWidth={1.9} />
    </button>
  )
}
