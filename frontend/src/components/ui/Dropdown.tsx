import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'

import { cn } from '../../lib/utils'

interface DropdownProps {
  trigger: React.ReactNode
  children: React.ReactNode | ((close: () => void) => React.ReactNode)
  align?: 'left' | 'right'
  width?: string
  className?: string
}

interface PanelPosition {
  top?: number
  bottom?: number
  left?: number
  right?: number
}

const PANEL_MAX_HEIGHT = 384 // matches max-h-96

/**
 * Dropdown rendered through a portal with fixed positioning, so it can never be
 * clipped by overflow-hidden ancestors (tables, cards, scroll areas).
 */
export function Dropdown({ trigger, children, align = 'left', width = 'w-56', className }: DropdownProps) {
  const [open, setOpen] = useState(false)
  const [position, setPosition] = useState<PanelPosition>({})
  const triggerRef = useRef<HTMLDivElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)

  const openPanel = () => {
    const rect = triggerRef.current?.getBoundingClientRect()
    if (!rect) return
    const spaceBelow = window.innerHeight - rect.bottom
    const openUp = spaceBelow < Math.min(PANEL_MAX_HEIGHT, 280) && rect.top > spaceBelow
    setPosition({
      top: openUp ? undefined : rect.bottom + 6,
      bottom: openUp ? window.innerHeight - rect.top + 6 : undefined,
      left: align === 'left' ? rect.left : undefined,
      right: align === 'right' ? window.innerWidth - rect.right : undefined,
    })
    setOpen(true)
  }

  useEffect(() => {
    if (!open) return
    const onPointerDown = (e: MouseEvent) => {
      const target = e.target as Node
      if (triggerRef.current?.contains(target) || panelRef.current?.contains(target)) return
      setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false)
    const onScroll = (e: Event) => {
      // Scrolling inside the panel is fine; anything else moves the anchor → close
      if (panelRef.current?.contains(e.target as Node)) return
      setOpen(false)
    }
    const onResize = () => setOpen(false)
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

  const close = () => setOpen(false)

  return (
    <div ref={triggerRef} className={cn('relative', className)}>
      <div onClick={() => (open ? setOpen(false) : openPanel())}>{trigger}</div>
      {open &&
        createPortal(
          <div
            ref={panelRef}
            className={cn('menu-panel fixed z-[90] max-h-96 overflow-y-auto', width)}
            style={position}
          >
            {typeof children === 'function' ? children(close) : children}
          </div>,
          document.body,
        )}
    </div>
  )
}
