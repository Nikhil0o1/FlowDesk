import { ChevronRight } from 'lucide-react'
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'

import { cn } from '../../lib/utils'

/**
 * ClickUp-style cascading context menu.
 *
 * Opens at a screen point (anchored to a trigger button's corner, or the cursor
 * for right-click). Items can be plain actions, separators, or submenus that
 * fly out to the side on hover — including a custom panel (used for the
 * color/icon picker and the move-to-space picker).
 *
 * Drive it with {@link useRowMenu}, which wires the `⋯` trigger and row
 * right-click and returns the portal node to render.
 */

export type MenuItem =
  | {
      type: 'action'
      label: string
      icon?: React.ReactNode
      onClick: () => void
      danger?: boolean
      disabled?: boolean
      hint?: string
    }
  | { type: 'separator' }
  | { type: 'header'; label: string }
  | {
      type: 'toggle'
      label: string
      icon?: React.ReactNode
      checked: boolean
      onToggle: () => void
    }
  | {
      type: 'submenu'
      label: string
      icon?: React.ReactNode
      /** Nested menu items, or a custom panel (e.g. color picker). One of the two. */
      children?: MenuItem[]
      panel?: (close: () => void) => React.ReactNode
      disabled?: boolean
    }

export interface Anchor {
  x: number
  y: number
}

const PANEL_WIDTH = 232 // matches w-58-ish; keep in sync with className below
const VIEWPORT_PAD = 8

function clampToViewport(x: number, y: number, w: number, h: number) {
  let left = x
  let top = y
  if (left + w > window.innerWidth - VIEWPORT_PAD) left = Math.max(VIEWPORT_PAD, x - w)
  if (left < VIEWPORT_PAD) left = VIEWPORT_PAD
  if (top + h > window.innerHeight - VIEWPORT_PAD) top = Math.max(VIEWPORT_PAD, window.innerHeight - h - VIEWPORT_PAD)
  if (top < VIEWPORT_PAD) top = VIEWPORT_PAD
  return { left, top }
}

/** A menu panel (root or submenu). Self-positions and clamps to the viewport. */
function MenuPanel({
  items,
  anchor,
  preferLeft,
  onClose,
}: {
  items: MenuItem[]
  anchor: Anchor
  preferLeft?: boolean
  onClose: () => void
}) {
  const ref = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState<{ left: number; top: number }>({ left: -9999, top: anchor.y })
  const [openSub, setOpenSub] = useState<number | null>(null)
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const w = el.offsetWidth
    const h = el.offsetHeight
    const startX = preferLeft ? anchor.x - w : anchor.x
    setPos(clampToViewport(startX, anchor.y, w, h))
  }, [anchor.x, anchor.y, preferLeft, items])

  const scheduleCloseSub = () => {
    if (closeTimer.current) clearTimeout(closeTimer.current)
    closeTimer.current = setTimeout(() => setOpenSub(null), 180)
  }
  const cancelCloseSub = () => {
    if (closeTimer.current) clearTimeout(closeTimer.current)
  }

  return (
    <div
      ref={ref}
      className="menu-panel fixed z-[95] max-h-[80vh] overflow-y-auto"
      style={{ left: pos.left, top: pos.top, width: PANEL_WIDTH }}
      onContextMenu={(e) => e.preventDefault()}
    >
      {items.map((item, i) => {
        if (item.type === 'separator') return <div key={i} className="my-1 h-px bg-ink-700" />

        if (item.type === 'header') {
          return (
            <p key={i} className="px-3 pb-1 pt-2 text-[11px] font-semibold uppercase tracking-wider text-fg-muted">
              {item.label}
            </p>
          )
        }

        if (item.type === 'toggle') {
          return (
            <button
              key={i}
              onMouseEnter={() => setOpenSub(null)}
              onClick={(e) => {
                e.preventDefault()
                e.stopPropagation()
                item.onToggle() // stays open — toggles are sticky
              }}
              className="flex w-full items-center gap-2.5 rounded-lg px-3 py-1.5 text-left text-sm text-fg-secondary transition-colors hover:bg-ink-750 hover:text-fg"
            >
              {item.icon && <span className="shrink-0">{item.icon}</span>}
              <span className="min-w-0 flex-1 truncate">{item.label}</span>
              <span
                className={cn(
                  'flex h-4 w-7 shrink-0 items-center rounded-full p-0.5 transition-colors',
                  item.checked ? 'justify-end bg-brand' : 'justify-start bg-ink-600',
                )}
              >
                <span className="h-3 w-3 rounded-full bg-white" />
              </span>
            </button>
          )
        }

        if (item.type === 'submenu') {
          return (
            <SubmenuItem
              key={i}
              item={item}
              open={openSub === i}
              onOpen={() => {
                cancelCloseSub()
                setOpenSub(i)
              }}
              onScheduleClose={scheduleCloseSub}
              onCancelClose={cancelCloseSub}
              onClose={onClose}
            />
          )
        }

        return (
          <button
            key={i}
            disabled={item.disabled}
            onMouseEnter={() => setOpenSub(null)}
            onClick={(e) => {
              e.preventDefault()
              e.stopPropagation()
              if (item.disabled) return
              item.onClick()
              onClose()
            }}
            className={cn(
              'flex w-full items-center gap-2.5 rounded-lg px-3 py-1.5 text-left text-sm transition-colors disabled:cursor-not-allowed disabled:opacity-40',
              item.danger
                ? 'text-rose-400 hover:bg-rose-500/10 hover:text-rose-300'
                : 'text-fg-secondary hover:bg-ink-750 hover:text-fg',
            )}
          >
            {item.icon && <span className="shrink-0">{item.icon}</span>}
            <span className="min-w-0 flex-1 truncate">{item.label}</span>
            {item.hint && <span className="shrink-0 text-[10px] text-fg-muted">{item.hint}</span>}
          </button>
        )
      })}
    </div>
  )
}

function SubmenuItem({
  item,
  open,
  onOpen,
  onScheduleClose,
  onCancelClose,
  onClose,
}: {
  item: Extract<MenuItem, { type: 'submenu' }>
  open: boolean
  onOpen: () => void
  onScheduleClose: () => void
  onCancelClose: () => void
  onClose: () => void
}) {
  const rowRef = useRef<HTMLButtonElement>(null)
  const [subAnchor, setSubAnchor] = useState<Anchor | null>(null)
  const [preferLeft, setPreferLeft] = useState(false)

  useEffect(() => {
    if (!open) {
      setSubAnchor(null)
      return
    }
    const r = rowRef.current?.getBoundingClientRect()
    if (!r) return
    // Open to the right unless it would overflow; flyout overlaps the row's top edge.
    const wouldOverflow = r.right + PANEL_WIDTH > window.innerWidth - VIEWPORT_PAD
    setPreferLeft(wouldOverflow)
    setSubAnchor({ x: wouldOverflow ? r.left : r.right, y: r.top - 6 })
  }, [open])

  return (
    <div onMouseEnter={onOpen} onMouseLeave={onScheduleClose}>
      <button
        ref={rowRef}
        disabled={item.disabled}
        className={cn(
          'flex w-full items-center gap-2.5 rounded-lg px-3 py-1.5 text-left text-sm transition-colors disabled:cursor-not-allowed disabled:opacity-40',
          open ? 'bg-ink-750 text-fg' : 'text-fg-secondary hover:bg-ink-750 hover:text-fg',
        )}
      >
        {item.icon && <span className="shrink-0">{item.icon}</span>}
        <span className="min-w-0 flex-1 truncate">{item.label}</span>
        <ChevronRight size={13} className="shrink-0 text-fg-muted" />
      </button>
      {open &&
        subAnchor &&
        createPortal(
          <div onMouseEnter={onCancelClose} onMouseLeave={onScheduleClose}>
            {item.panel ? (
              <CustomSubPanel anchor={subAnchor} preferLeft={preferLeft}>
                {item.panel(onClose)}
              </CustomSubPanel>
            ) : (
              <MenuPanel items={item.children ?? []} anchor={subAnchor} preferLeft={preferLeft} onClose={onClose} />
            )}
          </div>,
          document.body,
        )}
    </div>
  )
}

/** Wraps an arbitrary panel (color picker, space picker) with the same positioning logic. */
function CustomSubPanel({
  anchor,
  preferLeft,
  children,
}: {
  anchor: Anchor
  preferLeft?: boolean
  children: React.ReactNode
}) {
  const ref = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState<{ left: number; top: number }>({ left: -9999, top: anchor.y })
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const startX = preferLeft ? anchor.x - el.offsetWidth : anchor.x
    setPos(clampToViewport(startX, anchor.y, el.offsetWidth, el.offsetHeight))
  }, [anchor.x, anchor.y, preferLeft])
  return (
    <div
      ref={ref}
      className="menu-panel fixed z-[95] max-h-[80vh] overflow-y-auto"
      style={{ left: pos.left, top: pos.top }}
      onContextMenu={(e) => e.preventDefault()}
    >
      {children}
    </div>
  )
}

/** Root context menu: portal + outside-click/Escape close. */
export function ContextMenu({
  items,
  anchor,
  onClose,
}: {
  items: MenuItem[]
  anchor: Anchor
  onClose: () => void
}) {
  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      const target = e.target as HTMLElement
      if (target.closest('.menu-panel')) return
      onClose()
    }
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    const onScroll = (e: Event) => {
      if ((e.target as HTMLElement)?.closest?.('.menu-panel')) return
      onClose()
    }
    // Defer attaching so the opening click doesn't immediately close it.
    const id = setTimeout(() => {
      document.addEventListener('mousedown', onDown)
      window.addEventListener('scroll', onScroll, true)
    }, 0)
    document.addEventListener('keydown', onKey)
    window.addEventListener('resize', onClose)
    return () => {
      clearTimeout(id)
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
      window.removeEventListener('scroll', onScroll, true)
      window.removeEventListener('resize', onClose)
    }
  }, [onClose])

  return createPortal(<MenuPanel items={items} anchor={anchor} onClose={onClose} />, document.body)
}

/**
 * Wires a sidebar row to a context menu: right-click anywhere on the row and a
 * `⋯` trigger button both open the same menu. Returns the portal node to render.
 */
export function useRowMenu(items: MenuItem[] | (() => MenuItem[])) {
  const [anchor, setAnchor] = useState<Anchor | null>(null)
  const close = () => setAnchor(null)

  const onContextMenu = (e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setAnchor({ x: e.clientX, y: e.clientY })
  }
  const onTriggerClick = (e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect()
    setAnchor({ x: r.left, y: r.bottom + 4 })
  }

  const resolved = typeof items === 'function' ? items : () => items
  const node = anchor ? <ContextMenu items={resolved()} anchor={anchor} onClose={close} /> : null

  return { onContextMenu, onTriggerClick, node, open: !!anchor, close }
}
