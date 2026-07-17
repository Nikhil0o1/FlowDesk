import { cloneElement, isValidElement, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'

import { cn } from '../../lib/utils'

interface DropdownProps {
  trigger: React.ReactNode
  children: React.ReactNode | ((close: () => void) => React.ReactNode)
  align?: 'left' | 'right'
  width?: string
  className?: string
  /** Prefer opening above the trigger when there is room (e.g. toolbars near the bottom). */
  preferUp?: boolean
}

interface PanelPosition {
  top: number
  left?: number
  right?: number
  maxHeight: number
}

const PANEL_GAP = 6
const PANEL_MARGIN = 8
/** Prefer opening downward unless less than this remains below the trigger. */
const MIN_DOWN_SPACE = 120

/**
 * Dropdown rendered through a portal with fixed positioning, so it can never be
 * clipped by overflow-hidden ancestors (tables, cards, scroll areas).
 *
 * Prefers opening downward; only flips upward when there is clearly more room
 * above than below. Always stays anchored to the trigger (never floats to the
 * bottom of the viewport independently).
 */
export function Dropdown({
  trigger,
  children,
  align = 'left',
  width = 'w-56',
  className,
  preferUp = false,
}: DropdownProps) {
  const [open, setOpen] = useState(false)
  const [position, setPosition] = useState<PanelPosition | null>(null)
  const triggerRef = useRef<HTMLDivElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)

  const placePanel = () => {
    const rect = triggerRef.current?.getBoundingClientRect()
    const panel = panelRef.current
    if (!rect) return

    const viewportH = window.innerHeight
    const viewportW = window.innerWidth
    const measured = panel?.scrollHeight ?? 0
    const spaceBelow = viewportH - rect.bottom - PANEL_GAP - PANEL_MARGIN
    const spaceAbove = rect.top - PANEL_GAP - PANEL_MARGIN
    // Flip up when preferred, or when below is tight and above is clearly better.
    const openUp =
      (preferUp && spaceAbove >= 140) ||
      (spaceBelow < MIN_DOWN_SPACE && spaceAbove > spaceBelow + 24)
    const maxHeight = Math.max(140, openUp ? spaceAbove : spaceBelow)
    const usedHeight = Math.min(measured > 0 ? measured : maxHeight, maxHeight)

    // Keep near the trigger, but never clip off the viewport edges.
    let top = openUp ? rect.top - PANEL_GAP - usedHeight : rect.bottom + PANEL_GAP
    top = Math.min(Math.max(PANEL_MARGIN, top), viewportH - Math.min(usedHeight, maxHeight) - PANEL_MARGIN)

    const widthPx = panel?.offsetWidth ?? 224
    let left: number | undefined
    let right: number | undefined
    if (align === 'left') {
      left = Math.min(Math.max(PANEL_MARGIN, rect.left), viewportW - widthPx - PANEL_MARGIN)
    } else {
      right = Math.min(
        Math.max(PANEL_MARGIN, viewportW - rect.right),
        viewportW - widthPx - PANEL_MARGIN,
      )
    }

    setPosition((prev) => {
      const next: PanelPosition = { top, left, right, maxHeight }
      if (
        prev &&
        prev.top === next.top &&
        prev.left === next.left &&
        prev.right === next.right &&
        prev.maxHeight === next.maxHeight
      ) {
        return prev
      }
      return next
    })
  }

  const openPanel = () => {
    const rect = triggerRef.current?.getBoundingClientRect()
    if (!rect) return
    const spaceBelow = window.innerHeight - rect.bottom - PANEL_GAP - PANEL_MARGIN
    const spaceAbove = rect.top - PANEL_GAP - PANEL_MARGIN
    const openUp =
      (preferUp && spaceAbove >= 140) ||
      (spaceBelow < MIN_DOWN_SPACE && spaceAbove > spaceBelow + 24)
    const maxHeight = Math.max(140, openUp ? spaceAbove : spaceBelow)
    const guessedH = Math.min(280, maxHeight)
    setPosition({
      top: openUp ? rect.top - PANEL_GAP - guessedH : rect.bottom + PANEL_GAP,
      left: align === 'left' ? rect.left : undefined,
      right: align === 'right' ? window.innerWidth - rect.right : undefined,
      maxHeight,
    })
    setOpen(true)
  }

  const close = () => {
    setOpen(false)
    setPosition(null)
  }

  useLayoutEffect(() => {
    if (!open) return
    placePanel()
  }, [open, align, preferUp])

  // Remeasure when the panel's content size changes (e.g. members finish loading).
  useLayoutEffect(() => {
    if (!open) return
    const panel = panelRef.current
    if (!panel || typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(() => placePanel())
    ro.observe(panel)
    return () => ro.disconnect()
  }, [open, align, preferUp])

  useEffect(() => {
    if (!open) return
    const onPointerDown = (e: MouseEvent) => {
      const target = e.target as Node
      if (triggerRef.current?.contains(target) || panelRef.current?.contains(target)) return
      close()
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close()
    }
    const onScroll = (e: Event) => {
      if (panelRef.current?.contains(e.target as Node)) return
      close()
    }
    const onResize = () => close()
    document.addEventListener('mousedown', onPointerDown)
    document.addEventListener('keydown', onKey)
    window.addEventListener('scroll', onScroll, true)
    window.addEventListener('resize', onResize)
    return () => {
      document.removeEventListener('mousedown', onPointerDown)
      document.removeEventListener('keydown', onKey)
      window.removeEventListener('scroll', onScroll, true)
      window.removeEventListener('resize', onResize)
    }
  }, [open])

  const toggle = (e: React.MouseEvent) => {
    e.stopPropagation()
    if (open) close()
    else openPanel()
  }

  const renderedTrigger = isValidElement(trigger)
    ? cloneElement(trigger, {
        onClick: (e: React.MouseEvent) => {
          const props = trigger.props as { onClick?: (e: React.MouseEvent) => void }
          props.onClick?.(e)
          toggle(e)
        },
      } as never)
    : (
        <div role="presentation" onClick={toggle}>
          {trigger}
        </div>
      )

  return (
    <div ref={triggerRef} className={cn('relative inline-flex', className)}>
      {renderedTrigger}
      {open &&
        position &&
        createPortal(
          <>
            {/* Full-screen dismiss layer so the menu never gets "stuck" over the list. */}
            <div className="fixed inset-0 z-[89]" onMouseDown={close} aria-hidden />
            <div
              ref={panelRef}
              className={cn('menu-panel fixed z-[90] overflow-y-auto', width)}
              style={{
                top: position.top,
                left: position.left,
                right: position.right,
                maxHeight: position.maxHeight,
              }}
              onMouseDown={(e) => e.stopPropagation()}
            >
              {typeof children === 'function' ? children(close) : children}
            </div>
          </>,
          document.body,
        )}
    </div>
  )
}
