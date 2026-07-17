import { EyeOff, GripVertical, Plus, RotateCcw, Trash2 } from 'lucide-react'
import { useState } from 'react'

import { cn } from '../../lib/utils'
import { useSidebarSections } from '../../hooks/useSidebarSections'
import type { ResolvedSection } from '../../types/sidebarSections'
import { RenameModal } from '../ui/RenameModal'

/**
 * "Sections" tab of the Customize Sidebar dialog. Reorder (drag & drop),
 * hide/restore, and create custom sections. Every change is applied instantly
 * and persisted — there is no Save button.
 */
export function SectionsSettings() {
  const {
    sections,
    visibleSections,
    hiddenSections,
    reorder,
    hide,
    restore,
    createCustom,
    removeCustom,
  } = useSidebarSections()

  const [createOpen, setCreateOpen] = useState(false)
  const [dragId, setDragId] = useState<string | null>(null)
  const [overId, setOverId] = useState<string | null>(null)

  const handleDrop = (targetId: string) => {
    if (dragId && dragId !== targetId) {
      const targetIndex = sections.findIndex((s) => s.id === targetId)
      if (targetIndex !== -1) reorder(dragId, targetIndex)
    }
    setDragId(null)
    setOverId(null)
  }

  return (
    <div className="space-y-5">
      <section>
        <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-fg-muted">
          Sections
        </h3>
        <p className="mb-2.5 text-xs text-fg-muted">
          Drag to reorder. Hide a section to remove it from the sidebar.
        </p>

        <div className="space-y-1">
          {visibleSections.map((section) => (
            <SectionRow
              key={section.id}
              section={section}
              dragging={dragId === section.id}
              dropTarget={overId === section.id && dragId !== section.id}
              onDragStart={() => setDragId(section.id)}
              onDragEnter={() => setOverId(section.id)}
              onDragOver={(e) => e.preventDefault()}
              onDrop={() => handleDrop(section.id)}
              onDragEnd={() => {
                setDragId(null)
                setOverId(null)
              }}
              onHide={() => hide(section.id)}
              onDelete={section.isCustom ? () => removeCustom(section.id) : undefined}
            />
          ))}
          {visibleSections.length === 0 && (
            <p className="rounded-lg border border-dashed border-ink-700 px-3 py-3 text-center text-xs text-fg-muted">
              All sections are hidden.
            </p>
          )}
        </div>

        <button
          onClick={() => setCreateOpen(true)}
          className="mt-2 flex w-full items-center gap-2 rounded-lg border border-dashed border-ink-700 px-3 py-2 text-sm text-fg-muted transition-colors hover:border-ink-600 hover:text-fg-secondary"
        >
          <Plus size={15} /> Create Section
        </button>
      </section>

      <section>
        <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-fg-muted">
          Hidden sections
        </h3>
        {hiddenSections.length === 0 ? (
          <p className="text-xs text-fg-muted">All sections shown</p>
        ) : (
          <div className="space-y-1">
            {hiddenSections.map((section) => (
              <div
                key={section.id}
                className="flex items-center gap-2 rounded-lg px-2.5 py-2 text-sm text-fg-secondary"
              >
                <span className="flex-1 truncate">{section.title}</span>
                {section.isCustom && (
                  <button
                    onClick={() => removeCustom(section.id)}
                    className="rounded p-1 text-fg-muted transition-colors hover:bg-ink-750 hover:text-rose-400"
                    title="Delete section"
                    aria-label={`Delete ${section.title}`}
                  >
                    <Trash2 size={14} />
                  </button>
                )}
                <button
                  onClick={() => restore(section.id)}
                  className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium text-brand transition-colors hover:bg-brand-soft"
                >
                  <RotateCcw size={13} /> Restore
                </button>
              </div>
            ))}
          </div>
        )}
      </section>

      <RenameModal
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        title="Create Section"
        label="Section name"
        initialName=""
        onSave={async (name) => {
          createCustom(name)
          setCreateOpen(false)
        }}
      />
    </div>
  )
}

function SectionRow({
  section,
  dragging,
  dropTarget,
  onDragStart,
  onDragEnter,
  onDragOver,
  onDrop,
  onDragEnd,
  onHide,
  onDelete,
}: {
  section: ResolvedSection
  dragging: boolean
  dropTarget: boolean
  onDragStart: () => void
  onDragEnter: () => void
  onDragOver: (e: React.DragEvent) => void
  onDrop: () => void
  onDragEnd: () => void
  onHide: () => void
  onDelete?: () => void
}) {
  return (
    <div
      draggable
      onDragStart={(e) => {
        e.dataTransfer.effectAllowed = 'move'
        onDragStart()
      }}
      onDragEnter={onDragEnter}
      onDragOver={onDragOver}
      onDrop={onDrop}
      onDragEnd={onDragEnd}
      className={cn(
        'group flex items-center gap-2 rounded-lg border px-2 py-2 transition-colors',
        dragging ? 'border-brand/50 opacity-50' : 'border-ink-700 bg-ink-800/40 hover:bg-ink-750',
        dropTarget && 'border-brand',
      )}
    >
      <GripVertical size={15} className="shrink-0 cursor-grab text-fg-muted active:cursor-grabbing" />
      <span className="flex-1 truncate text-sm text-fg">{section.title}</span>
      {onDelete && (
        <button
          onClick={onDelete}
          className="rounded p-1 text-fg-muted opacity-0 transition-colors hover:bg-ink-700 hover:text-rose-400 group-hover:opacity-100"
          title="Delete section"
          aria-label={`Delete ${section.title}`}
        >
          <Trash2 size={14} />
        </button>
      )}
      <button
        onClick={onHide}
        className="rounded p-1 text-fg-muted transition-colors hover:bg-ink-700 hover:text-fg"
        title="Hide section"
        aria-label={`Hide ${section.title}`}
      >
        <EyeOff size={15} />
      </button>
    </div>
  )
}
