import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import {
  AlignCenter,
  AlignLeft,
  AlignRight,
  Ban,
  Bold,
  Bookmark,
  Check,
  ChevronDown,
  ChevronRight,
  Code,
  Eraser,
  FilePlus2,
  Flag,
  Image as ImageIcon,
  IndentDecrease,
  IndentIncrease,
  Italic,
  Link as LinkIcon,
  List,
  ListChecks,
  ListOrdered,
  ListTodo,
  MessageSquare,
  Minus,
  MoreHorizontal,
  MousePointer2,
  Pilcrow,
  Pin,
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
import type { DocBannerTone, DocBannerVariant, DocToolbarPosition, EditorApi } from '../../types/editor'
import { BANNER_PICKER_SWATCHES } from './DocBannerChrome'

export interface BubblePosition {
  top: number
  left: number
}

export interface SelectionSnapshot {
  text: string
  top: number
  bottom: number
  centerX: number
  width: number
}

interface DocSelectionBubbleProps {
  position: BubblePosition
  api: EditorApi
  canComment: boolean
  toolbarPosition: DocToolbarPosition
  onToolbarPositionChange: (value: DocToolbarPosition) => void
  onComment: () => void
  onCreateSubpage?: (snapshot: SelectionSnapshot) => void
  onCreateTask?: (snapshot: SelectionSnapshot) => void
  /** Called after a formatting command so the parent can re-anchor to the (possibly moved) selection. */
  onAfterCommand?: () => void
}

function captureSelectionSnapshot(): SelectionSnapshot | null {
  const sel = window.getSelection()
  if (!sel || sel.isCollapsed || sel.rangeCount === 0) return null
  const text = sel.toString().trim()
  if (!text) return null
  const rect = sel.getRangeAt(0).getBoundingClientRect()
  if (rect.width === 0 && rect.height === 0) return null
  return {
    text,
    top: rect.top,
    bottom: rect.bottom,
    centerX: rect.left + rect.width / 2,
    width: rect.width,
  }
}

type MenuId = 'list' | 'text' | 'color' | 'align' | 'more' | null
type SubMenuId = 'banners' | 'quote' | 'insert' | null

const TEXT_COLORS = [
  { label: 'Red', value: '#ef4444' },
  { label: 'Orange', value: '#f97316' },
  { label: 'Brown', value: '#a16207' },
  { label: 'Blue', value: '#3b82f6' },
  { label: 'Purple', value: '#a855f7' },
  { label: 'Pink', value: '#ec4899' },
  { label: 'Green', value: '#22c55e' },
  { label: 'Gray', value: '#9ca3af' },
  { label: 'Muted', value: '#6b7280' },
] as const

const HIGHLIGHT_COLORS = [
  { label: 'Pink', value: '#fecdd3' },
  { label: 'Orange', value: '#fed7aa' },
  { label: 'Yellow', value: '#fef08a' },
  { label: 'Blue', value: '#bfdbfe' },
  { label: 'Purple', value: '#e9d5ff' },
  { label: 'Magenta', value: '#f5d0fe' },
  { label: 'Green', value: '#bbf7d0' },
  { label: 'Gray', value: '#e5e7eb' },
] as const

const BADGE_COLORS = [
  { label: 'Red', value: '#ef4444' },
  { label: 'Orange', value: '#f97316' },
  { label: 'Amber', value: '#f59e0b' },
  { label: 'Blue', value: '#3b82f6' },
  { label: 'Indigo', value: '#6366f1' },
  { label: 'Purple', value: '#a855f7' },
  { label: 'Pink', value: '#ec4899' },
  { label: 'Green', value: '#22c55e' },
  { label: 'Teal', value: '#14b8a6' },
  { label: 'Cyan', value: '#06b6d4' },
  { label: 'Sky', value: '#0ea5e9' },
  { label: 'Slate', value: '#64748b' },
  { label: 'Gray', value: '#6b7280' },
  { label: 'Zinc', value: '#71717a' },
  { label: 'Stone', value: '#78716c' },
  { label: 'Neutral', value: '#737373' },
] as const

/**
 * Floating toolbar shown when the user selects text in the doc editor.
 * Intentionally omits AI actions (Improve / Edit).
 */
export function DocSelectionBubble({
  position,
  api,
  canComment,
  toolbarPosition,
  onToolbarPositionChange,
  onComment,
  onCreateSubpage,
  onCreateTask,
  onAfterCommand,
}: DocSelectionBubbleProps) {
  const rootRef = useRef<HTMLDivElement>(null)
  const [menu, setMenu] = useState<MenuId>(null)
  const [subMenu, setSubMenu] = useState<SubMenuId>(null)
  const [active, setActive] = useState(readActiveFormats)

  const refresh = useCallback(() => {
    setActive(readActiveFormats())
    onAfterCommand?.()
  }, [onAfterCommand])

  const run = useCallback(
    (fn: () => void, opts?: { refresh?: boolean }) => {
      fn()
      if (opts?.refresh !== false) refresh()
      setMenu(null)
      setSubMenu(null)
    },
    [refresh],
  )

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setSubMenu(null)
        setMenu(null)
      }
    }
    const onPointer = (e: MouseEvent) => {
      const target = e.target as HTMLElement | null
      if (rootRef.current?.contains(target)) return
      if (target?.closest?.('[data-doc-selection-menu]')) return
      setMenu(null)
      setSubMenu(null)
    }
    window.addEventListener('keydown', onKey)
    window.addEventListener('mousedown', onPointer)
    return () => {
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('mousedown', onPointer)
    }
  }, [])

  const [box, setBox] = useState({ top: Math.max(8, position.top), left: 12 })

  useLayoutEffect(() => {
    const el = rootRef.current
    const width = el?.offsetWidth ?? 480
    const left = Math.min(
      Math.max(12, position.left - width / 2),
      window.innerWidth - width - 12,
    )
    setBox({ top: Math.max(8, position.top), left })
  }, [position.top, position.left, menu])

  return createPortal(
    <div
      ref={rootRef}
      role="toolbar"
      aria-label="Selection formatting"
      style={{ position: 'fixed', top: box.top, left: box.left }}
      className="z-[60] flex max-w-[min(96vw,760px)] items-center gap-0.5 overflow-visible rounded-xl border border-ink-700 bg-ink-850 px-1.5 py-1 shadow-popover"
      onMouseDown={(e) => {
        if ((e.target as HTMLElement).closest('button, [role="menuitem"]')) e.preventDefault()
      }}
    >
      {canComment && (
        <>
          <BubbleTextButton
            label="Comment"
            icon={MessageSquare}
            onClick={() => run(onComment, { refresh: false })}
          />
          <Divider />
        </>
      )}

      <BubbleMenu
        open={menu === 'list'}
        onToggle={() => {
          setMenu((m) => (m === 'list' ? null : 'list'))
          setSubMenu(null)
        }}
        ariaLabel="Lists"
        trigger={
          <span className="flex items-center gap-0.5 px-1">
            <List size={15} strokeWidth={2} />
            <ChevronDown size={12} className="opacity-70" />
          </span>
        }
      >
        <MenuItem icon={List} label="Bullet list" onClick={() => run(api.bulletList)} />
        <MenuItem icon={ListOrdered} label="Numbered list" onClick={() => run(api.numberList)} />
        <MenuItem icon={ListChecks} label="Checklist" onClick={() => run(api.checklist)} />
      </BubbleMenu>

      <BubbleMenu
        open={menu === 'text'}
        onToggle={() => {
          setMenu((m) => (m === 'text' ? null : 'text'))
          setSubMenu(null)
        }}
        ariaLabel="Turn into"
        width="w-56"
        menuWidthPx={224}
        trigger={
          <span className="flex items-center gap-0.5 px-1.5 text-xs font-medium">
            {active.blockLabel}
            <ChevronDown size={12} className="opacity-70" />
          </span>
        }
      >
        <p className="px-2 py-1 text-[10px] font-semibold uppercase tracking-wide text-fg-muted">
          Turn into
        </p>
        <MenuItem
          icon={Pilcrow}
          label="Text"
          active={active.block === 'p'}
          onClick={() => run(api.paragraph)}
        />
        <MenuItem
          label="Heading 1"
          shortcut="Alt Ctrl 1"
          active={active.block === 'h1'}
          onClick={() => run(() => api.heading(1))}
          className="text-base font-semibold"
        />
        <MenuItem
          label="Heading 2"
          shortcut="Alt Ctrl 2"
          active={active.block === 'h2'}
          onClick={() => run(() => api.heading(2))}
          className="text-sm font-semibold"
        />
        <MenuItem
          label="Heading 3"
          shortcut="Alt Ctrl 3"
          active={active.block === 'h3'}
          onClick={() => run(() => api.heading(3))}
          className="text-sm font-medium"
        />
        <MenuItem
          label="Heading 4"
          shortcut="Alt Ctrl 4"
          active={active.block === 'h4'}
          onClick={() => run(() => api.heading(4))}
          className="text-xs font-medium"
        />
        <div className="my-1 h-px bg-ink-700" />
        <SubMenuRow
          open={subMenu === 'banners'}
          onToggle={() => setSubMenu((s) => (s === 'banners' ? null : 'banners'))}
          icon={Bookmark}
          label="Banners"
          panelTitle="Banners"
          panelWidth={220}
        >
          <BannerColorGrid
            onPick={(variant, tone) => run(() => api.banner(variant, tone))}
          />
        </SubMenuRow>
        <MenuItem icon={SquareCode} label="Code block" onClick={() => run(api.codeBlock)} />
        <SubMenuRow
          open={subMenu === 'quote'}
          onToggle={() => setSubMenu((s) => (s === 'quote' ? null : 'quote'))}
          icon={Quote}
          label="Quote"
          panelTitle="Quote"
          panelWidth={180}
        >
          <MenuItem label="Quote" onClick={() => run(api.quote)} />
          <MenuItem label="Callout tip" onClick={() => run(() => api.banner('tip', 'soft'))} />
        </SubMenuRow>
      </BubbleMenu>

      <BubbleMenu
        open={menu === 'color'}
        onToggle={() => {
          setMenu((m) => (m === 'color' ? null : 'color'))
          setSubMenu(null)
        }}
        ariaLabel="Text color"
        width="w-64"
        trigger={
          <span className="flex h-7 w-7 items-center justify-center text-sm font-semibold text-fg">
            <span className="border-b-2 border-red-500 leading-none">A</span>
          </span>
        }
      >
        <ColorSection title="Text colors">
          {TEXT_COLORS.map((c) => (
            <ColorSwatch
              key={`fg-${c.label}`}
              label={c.label}
              onClick={() => run(() => api.foreColor(c.value))}
            >
              <span className="text-sm font-semibold" style={{ color: c.value }}>
                A
              </span>
            </ColorSwatch>
          ))}
        </ColorSection>
        <ColorSection title="Text highlights">
          {HIGHLIGHT_COLORS.map((c) => (
            <ColorSwatch
              key={`hl-${c.label}`}
              label={c.label}
              onClick={() => run(() => api.hiliteColor(c.value))}
            >
              <span className="h-5 w-5 rounded-full border border-ink-700" style={{ background: c.value }} />
            </ColorSwatch>
          ))}
          <ColorSwatch label="Clear highlight" onClick={() => run(() => api.hiliteColor('transparent'))}>
            <Ban size={14} className="text-fg-muted" />
          </ColorSwatch>
        </ColorSection>
        <ColorSection title="Badges">
          {BADGE_COLORS.map((c) => (
            <ColorSwatch
              key={`badge-${c.label}`}
              label={c.label}
              onClick={() => run(() => api.badge(c.value))}
            >
              <span className="h-5 w-5 rounded-full" style={{ background: c.value }} />
            </ColorSwatch>
          ))}
          <ColorSwatch label="Clear badge" onClick={() => run(api.removeColor)}>
            <Ban size={14} className="text-fg-muted" />
          </ColorSwatch>
        </ColorSection>
        <button
          type="button"
          role="menuitem"
          className="menu-item mt-1 justify-center gap-2"
          onClick={() => run(api.removeColor)}
        >
          <Ban size={14} />
          Remove color
        </button>
      </BubbleMenu>

      <Divider />

      <IconButton label="Bold" icon={Bold} active={active.bold} onClick={() => run(api.bold)} />
      <IconButton label="Italic" icon={Italic} active={active.italic} onClick={() => run(api.italic)} />
      <IconButton
        label="Underline"
        icon={Underline}
        active={active.underline}
        onClick={() => run(api.underline)}
      />
      <IconButton
        label="Strikethrough"
        icon={Strikethrough}
        active={active.strike}
        onClick={() => run(api.strike)}
      />
      <IconButton label="Inline code" icon={Code} onClick={() => run(api.inlineCode)} />

      <BubbleMenu
        open={menu === 'align'}
        onToggle={() => {
          setMenu((m) => (m === 'align' ? null : 'align'))
          setSubMenu(null)
        }}
        ariaLabel="Alignment"
        trigger={
          <span className="flex items-center gap-0.5 px-1">
            <AlignLeft size={15} strokeWidth={2} />
            <ChevronDown size={12} className="opacity-70" />
          </span>
        }
      >
        <MenuItem
          icon={AlignLeft}
          label="Align left"
          active={active.align === 'left'}
          onClick={() => run(() => api.align('left'))}
        />
        <MenuItem
          icon={AlignCenter}
          label="Align center"
          active={active.align === 'center'}
          onClick={() => run(() => api.align('center'))}
        />
        <MenuItem
          icon={AlignRight}
          label="Align right"
          active={active.align === 'right'}
          onClick={() => run(() => api.align('right'))}
        />
        <div className="my-1 h-px bg-ink-700" />
        <MenuItem icon={IndentIncrease} label="Increase indent" onClick={() => run(api.indent)} />
        <MenuItem icon={IndentDecrease} label="Decrease indent" onClick={() => run(api.outdent)} />
      </BubbleMenu>

      <Divider />

      <IconButton label="Insert a link" icon={LinkIcon} onClick={() => run(api.link)} />
      {onCreateSubpage && (
        <IconButton
          label="Create subpage"
          icon={FilePlus2}
          onClick={() => {
            const snapshot = captureSelectionSnapshot()
            if (!snapshot) return
            run(() => onCreateSubpage(snapshot), { refresh: false })
          }}
        />
      )}
      {onCreateTask ? (
        <IconButton
          label="Create task"
          icon={ListTodo}
          onClick={() => {
            // Snapshot before any focus/menu teardown can clear the native selection.
            const snapshot = captureSelectionSnapshot()
            if (!snapshot) return
            run(() => onCreateTask(snapshot), { refresh: false })
          }}
        />
      ) : (
        <IconButton label="Checklist" icon={ListChecks} onClick={() => run(api.checklist)} />
      )}

      <BubbleMenu
        open={menu === 'more'}
        onToggle={() => {
          setMenu((m) => (m === 'more' ? null : 'more'))
          setSubMenu(null)
        }}
        ariaLabel="More"
        width="w-56"
        trigger={
          <span className="flex h-7 w-7 items-center justify-center">
            <MoreHorizontal size={15} strokeWidth={2} />
          </span>
        }
      >
        <MenuItem icon={Undo2} label="Undo" shortcut="Ctrl Z" onClick={() => run(api.undo)} />
        <MenuItem icon={Redo2} label="Redo" shortcut="Ctrl Shift Z" onClick={() => run(api.redo)} />
        <div className="my-1 h-px bg-ink-700" />
        <SubMenuRow
          open={subMenu === 'insert'}
          onToggle={() => setSubMenu((s) => (s === 'insert' ? null : 'insert'))}
          label="Insert"
        >
          <MenuItem icon={ImageIcon} label="Image" onClick={() => run(api.image)} />
          <MenuItem icon={TableIcon} label="Table" onClick={() => run(api.table)} />
          <MenuItem icon={Minus} label="Divider" onClick={() => run(api.divider)} />
          <MenuItem icon={SquareCode} label="Code block" onClick={() => run(api.codeBlock)} />
          <MenuItem icon={ListChecks} label="Task list" onClick={() => run(api.taskList)} />
        </SubMenuRow>
        <MenuItem icon={Eraser} label="Clear format" onClick={() => run(api.clearFormat)} />
        <MenuItem
          icon={Code}
          label="Copy Markdown"
          onClick={() => {
            void copySelectionAsMarkdown()
            setMenu(null)
            setSubMenu(null)
          }}
        />
        <div className="my-1 h-px bg-ink-700" />
        <p className="px-2 py-1 text-[10px] font-semibold uppercase tracking-wide text-fg-muted">
          Toolbar position
        </p>
        <MenuItem
          icon={MousePointer2}
          label="Floating"
          active={toolbarPosition === 'floating'}
          onClick={() => {
            onToolbarPositionChange('floating')
            setMenu(null)
            setSubMenu(null)
          }}
        />
        <MenuItem
          icon={Pin}
          label="Top"
          active={toolbarPosition === 'top'}
          onClick={() => {
            onToolbarPositionChange('top')
            setMenu(null)
            setSubMenu(null)
          }}
        />
      </BubbleMenu>
    </div>,
    document.body,
  )
}

function Divider() {
  return <span className="mx-0.5 h-5 w-px shrink-0 bg-ink-700" aria-hidden />
}

function IconButton({
  label,
  icon: Icon,
  active,
  onClick,
}: {
  label: string
  icon: LucideIcon
  active?: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      aria-pressed={active}
      onClick={onClick}
      className={cn(
        'flex h-7 w-7 shrink-0 items-center justify-center rounded-md transition-colors',
        active ? 'bg-ink-700 text-fg' : 'text-fg-secondary hover:bg-ink-750 hover:text-fg',
      )}
    >
      <Icon size={15} strokeWidth={2} />
    </button>
  )
}

function BubbleTextButton({
  label,
  icon: Icon,
  onClick,
}: {
  label: string
  icon: LucideIcon
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex h-7 shrink-0 items-center gap-1 rounded-md px-2 text-xs font-medium text-fg-secondary transition-colors hover:bg-ink-750 hover:text-fg"
    >
      <Icon size={13} strokeWidth={2} />
      {label}
    </button>
  )
}

function BubbleMenu({
  open,
  onToggle,
  ariaLabel,
  trigger,
  children,
  width = 'min-w-[11rem]',
  menuWidthPx = 224,
}: {
  open: boolean
  onToggle: () => void
  ariaLabel: string
  trigger: ReactNode
  children: ReactNode
  width?: string
  menuWidthPx?: number
}) {
  const triggerRef = useRef<HTMLButtonElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState({ top: 0, left: 0, maxHeight: 360 })

  useLayoutEffect(() => {
    if (!open || !triggerRef.current) return
    const place = () => {
      const rect = triggerRef.current!.getBoundingClientRect()
      const gap = 6
      const pad = 8
      const panelH = panelRef.current?.offsetHeight || 280
      const panelW = panelRef.current?.offsetWidth || menuWidthPx
      const spaceBelow = window.innerHeight - rect.bottom - gap - pad
      const spaceAbove = rect.top - gap - pad
      const openUp = spaceBelow < Math.min(panelH, 240) && spaceAbove > spaceBelow
      const maxHeight = Math.min(360, Math.max(160, openUp ? spaceAbove : spaceBelow))
      let top = openUp ? rect.top - gap - Math.min(panelH, maxHeight) : rect.bottom + gap
      top = Math.max(pad, Math.min(top, window.innerHeight - pad - 40))
      let left = rect.left
      if (left + panelW > window.innerWidth - pad) left = window.innerWidth - panelW - pad
      left = Math.max(pad, left)
      setPos({ top, left, maxHeight })
    }
    place()
    // Re-measure after paint once content height is known.
    requestAnimationFrame(place)
  }, [open, menuWidthPx])

  return (
    <div className="relative shrink-0">
      <button
        ref={triggerRef}
        type="button"
        aria-label={ariaLabel}
        aria-expanded={open}
        title={ariaLabel}
        onClick={onToggle}
        className={cn(
          'flex h-7 items-center rounded-md text-fg-secondary transition-colors',
          open ? 'bg-ink-700 text-fg' : 'hover:bg-ink-750 hover:text-fg',
        )}
      >
        {trigger}
      </button>
      {open &&
        createPortal(
          <div
            ref={panelRef}
            role="menu"
            data-doc-selection-menu=""
            className={cn(
              'fixed z-[90] overflow-y-auto rounded-xl border border-ink-700 bg-ink-850 p-1 shadow-popover',
              width,
            )}
            style={{ top: pos.top, left: pos.left, maxHeight: pos.maxHeight }}
            onMouseDown={(e) => e.stopPropagation()}
          >
            {children}
          </div>,
          document.body,
        )}
    </div>
  )
}

function SubMenuRow({
  open,
  onToggle,
  label,
  icon: Icon,
  children,
  panelTitle,
  panelWidth = 200,
}: {
  open: boolean
  onToggle: () => void
  label: string
  icon?: LucideIcon
  children: ReactNode
  panelTitle?: string
  panelWidth?: number
}) {
  const rowRef = useRef<HTMLButtonElement>(null)
  const [pos, setPos] = useState({ top: 0, left: 0 })

  useLayoutEffect(() => {
    if (!open || !rowRef.current) return
    const rect = rowRef.current.getBoundingClientRect()
    const gap = 6
    const pad = 8
    const panelH = 220
    let left = rect.right + gap
    if (left + panelWidth > window.innerWidth - pad) {
      left = Math.max(pad, rect.left - panelWidth - gap)
    }
    let top = rect.top
    if (top + panelH > window.innerHeight - pad) {
      top = Math.max(pad, window.innerHeight - panelH - pad)
    }
    setPos({ top, left })
  }, [open, panelWidth])

  return (
    <div className="relative">
      <button
        ref={rowRef}
        type="button"
        role="menuitem"
        aria-expanded={open}
        onClick={onToggle}
        className={cn('menu-item justify-between', open && 'bg-ink-750 text-fg')}
      >
        <span className="flex items-center gap-2">
          {Icon ? <Icon size={14} strokeWidth={1.9} /> : <span className="w-3.5" />}
          {label}
        </span>
        <ChevronRight size={14} className="opacity-70" />
      </button>
      {open &&
        createPortal(
          <div
            role="menu"
            aria-label={panelTitle || label}
            data-doc-selection-menu=""
            className="menu-panel fixed z-[95] p-1.5 shadow-popover"
            style={{ top: pos.top, left: pos.left, width: panelWidth }}
            onMouseDown={(e) => e.stopPropagation()}
          >
            {panelTitle && (
              <p className="px-1.5 pb-1.5 pt-0.5 text-[10px] font-semibold uppercase tracking-wide text-fg-muted">
                {panelTitle}
              </p>
            )}
            {children}
          </div>,
          document.body,
        )}
    </div>
  )
}

function BannerColorGrid({
  onPick,
}: {
  onPick: (variant: DocBannerVariant, tone: DocBannerTone) => void
}) {
  return (
    <div className="space-y-2 px-0.5 pb-0.5">
      <div className="grid grid-cols-4 gap-1.5">
        {BANNER_PICKER_SWATCHES.map((s) => (
          <button
            key={`solid-${s.variant}`}
            type="button"
            title={s.label}
            aria-label={s.label}
            role="menuitem"
            className="flex h-9 w-9 items-center justify-center rounded-lg hover:bg-ink-750"
            onClick={() => onPick(s.variant as DocBannerVariant, 'solid')}
          >
            <Flag size={18} style={{ color: s.color }} fill={s.color} />
          </button>
        ))}
      </div>
      <div className="grid grid-cols-4 gap-1.5">
        {BANNER_PICKER_SWATCHES.map((s) => (
          <button
            key={`soft-${s.variant}`}
            type="button"
            title={`${s.label} soft`}
            aria-label={`${s.label} soft`}
            role="menuitem"
            className="flex h-9 w-9 items-center justify-center rounded-lg hover:bg-ink-750"
            onClick={() => onPick(s.variant as DocBannerVariant, 'soft')}
          >
            <Flag size={18} style={{ color: s.soft }} fill={s.soft} strokeWidth={1.5} />
          </button>
        ))}
      </div>
    </div>
  )
}

function MenuItem({
  label,
  icon: Icon,
  active,
  shortcut,
  onClick,
  className,
}: {
  label: string
  icon?: LucideIcon
  active?: boolean
  shortcut?: string
  onClick: () => void
  className?: string
}) {
  return (
    <button
      type="button"
      role="menuitem"
      onClick={onClick}
      className={cn('menu-item justify-between gap-3', active && 'bg-ink-750 text-fg', className)}
    >
      <span className="flex items-center gap-2">
        {Icon ? <Icon size={14} strokeWidth={1.9} /> : null}
        {label}
      </span>
      {active ? <Check size={14} className="text-brand" /> : null}
      {shortcut && !active ? (
        <span className="text-[10px] tracking-wide text-fg-muted">{shortcut}</span>
      ) : null}
    </button>
  )
}

function ColorSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="px-1 py-1.5">
      <p className="mb-1.5 px-1 text-[10px] font-semibold uppercase tracking-wide text-fg-muted">{title}</p>
      <div className="flex flex-wrap gap-1">{children}</div>
    </div>
  )
}

function ColorSwatch({
  label,
  onClick,
  children,
}: {
  label: string
  onClick: () => void
  children: ReactNode
}) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      role="menuitem"
      onClick={onClick}
      className="flex h-7 w-7 items-center justify-center rounded-md border border-transparent hover:border-ink-600 hover:bg-ink-750"
    >
      {children}
    </button>
  )
}

function readActiveFormats() {
  const q = (cmd: string) => {
    try {
      return document.queryCommandState(cmd)
    } catch {
      return false
    }
  }
  let block: 'p' | 'h1' | 'h2' | 'h3' | 'h4' | 'other' = 'p'
  let blockLabel = 'Text'
  let align: 'left' | 'center' | 'right' | 'other' = 'left'
  try {
    const value = String(document.queryCommandValue('formatBlock') || '').toLowerCase()
    if (value.includes('h1')) {
      block = 'h1'
      blockLabel = 'Heading 1'
    } else if (value.includes('h2')) {
      block = 'h2'
      blockLabel = 'Heading 2'
    } else if (value.includes('h3')) {
      block = 'h3'
      blockLabel = 'Heading 3'
    } else if (value.includes('h4')) {
      block = 'h4'
      blockLabel = 'Heading 4'
    } else if (value.includes('blockquote')) {
      block = 'other'
      blockLabel = 'Quote'
    } else if (value.includes('pre')) {
      block = 'other'
      blockLabel = 'Code'
    }
  } catch {
    /* ignore */
  }
  try {
    if (document.queryCommandState('justifyCenter')) align = 'center'
    else if (document.queryCommandState('justifyRight')) align = 'right'
    else if (document.queryCommandState('justifyLeft')) align = 'left'
  } catch {
    /* ignore */
  }
  return {
    bold: q('bold'),
    italic: q('italic'),
    underline: q('underline'),
    strike: q('strikeThrough'),
    block,
    blockLabel,
    align,
  }
}

async function copySelectionAsMarkdown() {
  const sel = window.getSelection()
  if (!sel || sel.rangeCount === 0) return
  const fragment = sel.getRangeAt(0).cloneContents()
  const host = document.createElement('div')
  host.appendChild(fragment)
  const md = htmlToSimpleMarkdown(host).trim()
  if (!md) return
  try {
    await navigator.clipboard.writeText(md)
  } catch {
    /* clipboard may be blocked */
  }
}

function htmlToSimpleMarkdown(root: HTMLElement): string {
  const walk = (node: Node): string => {
    if (node.nodeType === Node.TEXT_NODE) return node.textContent ?? ''
    if (!(node instanceof HTMLElement)) {
      return Array.from(node.childNodes).map(walk).join('')
    }
    const tag = node.tagName.toLowerCase()
    const inner = Array.from(node.childNodes).map(walk).join('')
    switch (tag) {
      case 'strong':
      case 'b':
        return `**${inner}**`
      case 'em':
      case 'i':
        return `*${inner}*`
      case 'u':
        return inner
      case 's':
      case 'strike':
      case 'del':
        return `~~${inner}~~`
      case 'code':
        return node.closest('pre') ? inner : `\`${inner}\``
      case 'a': {
        const href = node.getAttribute('href') || ''
        return href ? `[${inner}](${href})` : inner
      }
      case 'h1':
        return `# ${inner}\n\n`
      case 'h2':
        return `## ${inner}\n\n`
      case 'h3':
        return `### ${inner}\n\n`
      case 'h4':
        return `#### ${inner}\n\n`
      case 'blockquote':
        return `> ${inner}\n\n`
      case 'li':
        return `- ${inner}\n`
      case 'br':
        return '\n'
      case 'p':
      case 'div':
        return `${inner}\n\n`
      default:
        return inner
    }
  }
  return walk(root).replace(/\n{3,}/g, '\n\n')
}
