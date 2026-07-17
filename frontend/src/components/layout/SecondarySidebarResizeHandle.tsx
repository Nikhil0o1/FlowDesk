import { useEffect, useRef } from 'react'

import {
  clampSecondarySidebarWidth,
  SECONDARY_SIDEBAR_DEFAULT_WIDTH,
} from '../../lib/sidebarLayout'
import { modKeyLabel } from '../../lib/keyboard'
import { cn } from '../../lib/utils'

export function SecondarySidebarResizeHandle({
  width,
  onWidthChange,
  onReset,
  onResizingChange,
}: {
  width: number
  onWidthChange: (width: number) => void
  onReset: () => void
  onResizingChange?: (resizing: boolean) => void
}) {
  const dragging = useRef(false)
  const startX = useRef(0)
  const startWidth = useRef(width)

  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      if (!dragging.current) return
      const next = clampSecondarySidebarWidth(startWidth.current + (e.clientX - startX.current))
      onWidthChange(next)
    }

    const onUp = () => {
      if (!dragging.current) return
      dragging.current = false
      onResizingChange?.(false)
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
    }

    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseup', onUp)
    return () => {
      document.removeEventListener('mousemove', onMove)
      document.removeEventListener('mouseup', onUp)
    }
  }, [onResizingChange, onWidthChange])

  const mod = modKeyLabel()

  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-valuenow={width}
      aria-valuemin={200}
      aria-valuemax={480}
      title={`Drag to resize · Double-click to reset · ${mod}+\\ to close`}
      onMouseDown={(e) => {
        e.preventDefault()
        dragging.current = true
        startX.current = e.clientX
        startWidth.current = width
        onResizingChange?.(true)
        document.body.style.cursor = 'col-resize'
        document.body.style.userSelect = 'none'
      }}
      onDoubleClick={(e) => {
        e.preventDefault()
        onReset()
      }}
      className={cn(
        'group/handle absolute right-0 top-0 z-30 h-full w-2 -translate-x-1/2 cursor-col-resize',
        'touch-none select-none',
      )}
    >
      <span
        className={cn(
          'absolute inset-y-0 left-1/2 w-px -translate-x-1/2 bg-transparent transition-colors',
          'group-hover/handle:bg-brand/70 group-active/handle:bg-brand',
        )}
      />
    </div>
  )
}

export { SECONDARY_SIDEBAR_DEFAULT_WIDTH }
