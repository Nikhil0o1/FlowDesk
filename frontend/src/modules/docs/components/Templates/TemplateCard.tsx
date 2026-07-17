import { Copy, Eye, FileText, Plus } from 'lucide-react'

import type { DocTemplate } from '../../types/template'

/** A single template tile with Use / Preview / Duplicate actions. */
export function TemplateCard({
  template,
  onUse,
  onPreview,
  onDuplicate,
}: {
  template: DocTemplate
  onUse: () => void
  onPreview: () => void
  onDuplicate: () => void
}) {
  return (
    <div className="flex flex-col gap-3 rounded-xl border border-ink-700 bg-ink-800 p-4 transition-colors hover:border-ink-600">
      <div className="flex items-start justify-between gap-2">
        <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-brand-soft text-brand">
          <FileText size={18} />
        </span>
        <span className="rounded-full bg-ink-750 px-2 py-0.5 text-[11px] font-medium text-fg-secondary">
          {template.category}
        </span>
      </div>
      <div className="min-w-0 flex-1">
        <h3 className="truncate text-sm font-semibold text-fg">{template.name}</h3>
        <p className="mt-1 line-clamp-2 text-xs text-fg-secondary">{template.description}</p>
      </div>
      <div className="flex items-center gap-1.5">
        <button type="button" onClick={onUse} className="btn-primary flex-1 !py-1.5 text-xs">
          <Plus size={14} /> Use
        </button>
        <button
          type="button"
          onClick={onPreview}
          title="Preview"
          aria-label={`Preview ${template.name}`}
          className="flex h-8 w-8 items-center justify-center rounded-lg border border-ink-700 bg-ink-800 text-fg-secondary transition-colors hover:bg-ink-750 hover:text-fg"
        >
          <Eye size={15} />
        </button>
        <button
          type="button"
          onClick={onDuplicate}
          title="Duplicate to a new doc"
          aria-label={`Duplicate ${template.name}`}
          className="flex h-8 w-8 items-center justify-center rounded-lg border border-ink-700 bg-ink-800 text-fg-secondary transition-colors hover:bg-ink-750 hover:text-fg"
        >
          <Copy size={15} />
        </button>
      </div>
    </div>
  )
}
