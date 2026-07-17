import { ArrowLeftRight, GripHorizontal } from 'lucide-react'
import { useEffect, useRef } from 'react'

import {
  clampMyTasksCardColSpan,
  clampMyTasksCardHeight,
  colSpanFromPixelWidth,
  DEFAULT_MY_TASKS_CARD_SIZES,
  type MyTasksCardSize,
} from '../../lib/myTasksCardLayout'
import type { MyTasksCardId } from '../../lib/myTasksCards'
import { cn } from '../../lib/utils'

/** Drag the right edge to change card width (grid column span). */
export function MyTasksCardWidthResizeHandle({
  colSpan,
  onColSpanChange,
  onReset,
  onResizeEnd,
}: {
  colSpan: number
  onColSpanChange: (span: number) => void
  onReset: () => void
  onResizeEnd?: () => void
}) {
  const dragging = useRef(false)
  const startX = useRef(0)
  const startSpan = useRef(colSpan)
  const cardRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      if (!dragging.current) return
      const card = cardRef.current?.closest('[data-my-tasks-card]') as HTMLElement | null
      const grid = card?.parentElement?.parentElement
      if (!card || !grid) return
      const gridWidth = grid.getBoundingClientRect().width
      const cardWidth = (startSpan.current / 12) * gridWidth + (e.clientX - startX.current)
      onColSpanChange(colSpanFromPixelWidth(cardWidth, gridWidth))
    }

    const onUp = () => {
      if (!dragging.current) return
      dragging.current = false
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
      onResizeEnd?.()
    }

    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseup', onUp)
    return () => {
      document.removeEventListener('mousemove', onMove)
      document.removeEventListener('mouseup', onUp)
    }
  }, [onColSpanChange, onResizeEnd])

  return (
    <div
      ref={cardRef}
      role="separator"
      aria-orientation="vertical"
      aria-valuenow={colSpan}
      title="Drag to resize width · Double-click to reset"
      onMouseDown={(e) => {
        e.preventDefault()
        e.stopPropagation()
        dragging.current = true
        startX.current = e.clientX
        startSpan.current = colSpan
        document.body.style.cursor = 'col-resize'
        document.body.style.userSelect = 'none'
      }}
      onDoubleClick={(e) => {
        e.preventDefault()
        e.stopPropagation()
        onReset()
      }}
      className={cn(
        'group/width absolute right-0 top-0 z-20 h-full w-3 translate-x-1/2 cursor-col-resize touch-none select-none',
      )}
    >
      <span className="absolute inset-y-0 left-1/2 w-px -translate-x-1/2 bg-transparent transition-colors group-hover/width:bg-brand/70 group-active/width:bg-brand" />
      <span className="pointer-events-none absolute right-0 top-1/2 flex -translate-y-1/2 translate-x-1/2 items-center justify-center rounded bg-ink-800/90 p-0.5 text-fg-muted opacity-0 shadow-sm ring-1 ring-ink-600 transition-opacity group-hover/width:opacity-100">
        <ArrowLeftRight size={10} aria-hidden />
      </span>
    </div>
  )
}

/** Drag the bottom edge to change card height. */
export function MyTasksCardHeightResizeHandle({
  height,
  onHeightChange,
  onReset,
  onResizeEnd,
}: {
  height: number
  onHeightChange: (height: number) => void
  onReset: () => void
  onResizeEnd?: () => void
}) {
  const dragging = useRef(false)
  const startY = useRef(0)
  const startHeight = useRef(height)

  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      if (!dragging.current) return
      onHeightChange(clampMyTasksCardHeight(startHeight.current + (e.clientY - startY.current)))
    }

    const onUp = () => {
      if (!dragging.current) return
      dragging.current = false
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
      onResizeEnd?.()
    }

    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseup', onUp)
    return () => {
      document.removeEventListener('mousemove', onMove)
      document.removeEventListener('mouseup', onUp)
    }
  }, [onHeightChange, onResizeEnd])

  return (
    <div
      role="separator"
      aria-orientation="horizontal"
      aria-valuenow={height}
      title="Drag to resize height · Double-click to reset"
      onMouseDown={(e) => {
        e.preventDefault()
        e.stopPropagation()
        dragging.current = true
        startY.current = e.clientY
        startHeight.current = height
        document.body.style.cursor = 'row-resize'
        document.body.style.userSelect = 'none'
      }}
      onDoubleClick={(e) => {
        e.preventDefault()
        e.stopPropagation()
        onReset()
      }}
      className="group/height absolute bottom-0 left-0 right-0 z-20 h-3 -translate-y-1/2 cursor-row-resize touch-none select-none"
    >
      <span className="absolute left-0 right-0 top-1/2 h-px -translate-y-1/2 bg-transparent transition-colors group-hover/height:bg-brand/70 group-active/height:bg-brand" />
      <span className="pointer-events-none absolute bottom-0 left-1/2 flex -translate-x-1/2 translate-y-1/2 items-center justify-center rounded bg-ink-800/90 p-0.5 text-fg-muted opacity-0 shadow-sm ring-1 ring-ink-600 transition-opacity group-hover/height:opacity-100">
        <GripHorizontal size={10} aria-hidden />
      </span>
    </div>
  )
}

export function defaultCardSize(cardId: MyTasksCardId): MyTasksCardSize {
  return DEFAULT_MY_TASKS_CARD_SIZES[cardId]
}

export function resetCardSizePatch(cardId: MyTasksCardId): Partial<MyTasksCardSize> {
  const d = DEFAULT_MY_TASKS_CARD_SIZES[cardId]
  return { height: clampMyTasksCardHeight(d.height), colSpan: clampMyTasksCardColSpan(d.colSpan) }
}
