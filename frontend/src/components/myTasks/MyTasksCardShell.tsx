import { ChevronRight, GripVertical, MoreHorizontal, Plus, Trash2 } from 'lucide-react'
import { useState } from 'react'

import { Dropdown } from '../ui/Dropdown'
import { resolveMyTasksCardSize } from '../../lib/myTasksCardLayout'
import { cn } from '../../lib/utils'
import type { MyTasksCardId } from '../../lib/myTasksCards'
import { MY_TASKS_CARD_LABELS } from '../../lib/myTasksCards'
import { useUIStore } from '../../stores/ui'
import {
  MyTasksCardHeightResizeHandle,
  MyTasksCardWidthResizeHandle,
  resetCardSizePatch,
} from './MyTasksCardResizeHandles'

export function MyTasksCardShell({
  cardId,
  title,
  toolbar,
  onAdd,
  hideAdd = false,
  headerActions,
  className,
  bodyClassName,
  children,
  onDragHandlePointerDown,
  onDragOver,
  onDrop,
  isDragTarget,
}: {
  cardId: MyTasksCardId
  title?: string
  toolbar?: React.ReactNode
  onAdd?: () => void
  hideAdd?: boolean
  headerActions?: React.ReactNode
  className?: string
  bodyClassName?: string
  children: React.ReactNode
  onDragHandlePointerDown?: (e: React.DragEvent) => void
  onDragOver?: (e: React.DragEvent) => void
  onDrop?: () => void
  isDragTarget?: boolean
}) {
  const collapsed = useUIStore((s) => s.myTasksCardsCollapsed.includes(cardId))
  const toggleCollapsed = useUIStore((s) => s.toggleMyTasksCardCollapsed)
  const hideCard = useUIStore((s) => s.hideMyTasksCard)
  const sizeOverrides = useUIStore((s) => s.myTasksCardSizes[cardId])
  const setCardSize = useUIStore((s) => s.setMyTasksCardSize)
  const [resizing, setResizing] = useState(false)

  const { height } = resolveMyTasksCardSize(cardId, sizeOverrides)
  const label = title ?? MY_TASKS_CARD_LABELS[cardId]
  const expanded = !collapsed

  const resetSize = () => setCardSize(cardId, resetCardSizePatch(cardId))

  return (
    <section
      data-my-tasks-card={cardId}
      className={cn(
        'relative flex flex-col overflow-hidden rounded-2xl border border-ink-700 bg-ink-850/40',
        !resizing && 'transition-[height,box-shadow] duration-150',
        expanded ? '' : 'h-auto',
        isDragTarget && 'ring-2 ring-brand/40',
        className,
      )}
      style={expanded ? { height } : undefined}
      onDragOver={(e) => {
        e.preventDefault()
        onDragOver?.(e)
      }}
      onDrop={(e) => {
        e.preventDefault()
        onDrop?.()
      }}
    >
      <header className="flex shrink-0 items-center gap-0.5 border-b border-ink-700/60 px-2 py-2">
        <button
          type="button"
          draggable
          onDragStart={onDragHandlePointerDown}
          className="btn-ghost !cursor-grab !p-1 text-fg-muted active:!cursor-grabbing"
          title="Drag card"
          aria-label="Drag card"
        >
          <GripVertical size={15} />
        </button>
        <button
          type="button"
          onClick={() => toggleCollapsed(cardId)}
          className="btn-ghost !p-1 text-fg-muted hover:text-fg"
          aria-label={expanded ? 'Collapse card' : 'Expand card'}
          title={expanded ? 'Collapse' : 'Expand'}
        >
          <ChevronRight size={14} className={cn('transition-transform', expanded && 'rotate-90')} />
        </button>
        <h2 className="min-w-0 flex-1 truncate text-sm font-semibold text-fg">{label}</h2>
        {onAdd && !hideAdd && (
          <button type="button" className="btn-ghost !p-1.5" title="Add" onClick={onAdd}>
            <Plus size={15} />
          </button>
        )}
        {headerActions}
        <Dropdown
          align="right"
          width="w-44"
          trigger={
            <button
              type="button"
              className="btn-ghost !p-1.5"
              title="More options"
              aria-label="More options"
            >
              <MoreHorizontal size={15} />
            </button>
          }
        >
          {(close) => (
            <button
              type="button"
              className="menu-item w-full text-red-400 hover:bg-red-500/10 hover:text-red-300"
              onClick={() => {
                hideCard(cardId)
                close()
              }}
            >
              <Trash2 size={14} />
              Delete card
            </button>
          )}
        </Dropdown>
      </header>

      {expanded && (
        <>
          {toolbar && <div className="shrink-0 border-b border-ink-700/60">{toolbar}</div>}
          <div className={cn('flex min-h-0 flex-1 flex-col overflow-hidden', bodyClassName)}>
            {children}
          </div>
          <MyTasksCardWidthResizeHandle
            colSpan={resolveMyTasksCardSize(cardId, sizeOverrides).colSpan}
            onColSpanChange={(colSpan) => {
              setResizing(true)
              setCardSize(cardId, { colSpan })
            }}
            onReset={resetSize}
            onResizeEnd={() => setResizing(false)}
          />
          <MyTasksCardHeightResizeHandle
            height={height}
            onHeightChange={(next) => {
              setResizing(true)
              setCardSize(cardId, { height: next })
            }}
            onReset={resetSize}
            onResizeEnd={() => setResizing(false)}
          />
        </>
      )}
    </section>
  )
}
