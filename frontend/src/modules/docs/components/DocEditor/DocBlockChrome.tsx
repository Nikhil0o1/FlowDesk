import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import {
  Code2,
  Copy,
  CornerDownLeft,
  GripHorizontal,
  GripVertical,
  Image as ImageIcon,
  Link2,
  Plus,
  Table2,
  Trash2,
} from 'lucide-react'
import { createPortal } from 'react-dom'

import { cn } from '../../../../lib/utils'
import { toast } from '../../../../stores/toast'
import {
  copyCodeToClipboard,
  placeCaretAfterCodeBlock,
  setCodeBlockMinHeight,
} from './docCodeBlock'
import {
  copyBlockLink,
  deleteEditorBlock,
  duplicateEditorBlock,
  type DocBlockType,
} from './docEditorBlocks'
import { copyImageToClipboard } from './docImageBlock'
import {
  addColumn,
  addRow,
  copyTableToClipboard,
  getFocusedCell,
  getTableFromBlock,
  resizeColumn,
} from './docTableBlock'

interface DocBlockChromeProps {
  block: HTMLElement
  blockType: DocBlockType
  docId: string
  readOnly?: boolean
  onChange: () => void
  onClose: () => void
}

type MenuKind = 'block' | 'column'

const PANEL_WIDTH = 208
const VIEWPORT_PAD = 8

function clampMenuPosition(anchor: DOMRect, panelW: number, panelH: number, kind: MenuKind) {
  const gap = 6
  const spaceBelow = window.innerHeight - anchor.bottom - gap - VIEWPORT_PAD
  const spaceAbove = anchor.top - gap - VIEWPORT_PAD
  const openUp = panelH > spaceBelow && spaceAbove > spaceBelow

  let top = openUp ? anchor.top - gap - panelH : anchor.bottom + gap
  top = Math.min(Math.max(VIEWPORT_PAD, top), window.innerHeight - panelH - VIEWPORT_PAD)

  let left =
    kind === 'block'
      ? anchor.right + gap
      : anchor.left + anchor.width / 2 - panelW / 2
  if (left + panelW > window.innerWidth - VIEWPORT_PAD) {
    left = kind === 'block' ? anchor.left - panelW - gap : window.innerWidth - panelW - VIEWPORT_PAD
  }
  left = Math.max(VIEWPORT_PAD, left)

  return { top, left }
}

function blockLabel(type: DocBlockType) {
  if (type === 'table') return 'Table'
  if (type === 'image') return 'Image'
  return 'Code block'
}

export function DocBlockChrome({ block, blockType, docId, readOnly, onChange, onClose }: DocBlockChromeProps) {
  const [rect, setRect] = useState<DOMRect | null>(null)
  const [menuOpen, setMenuOpen] = useState<MenuKind | null>(null)
  const [menuPos, setMenuPos] = useState({ top: 0, left: 0 })
  const [activeCol, setActiveCol] = useState(0)
  const [hoverColEdge, setHoverColEdge] = useState<number | null>(null)
  const resizeRef = useRef<{ col: number; startX: number } | null>(null)
  const heightResizeRef = useRef<{ startY: number; startH: number } | null>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const menuAnchorRef = useRef<DOMRect | null>(null)

  const table = useMemo(() => (blockType === 'table' ? getTableFromBlock(block) : null), [block, blockType])

  const updateRect = useCallback(() => {
    const tableEl = table ?? undefined
    const focus = tableEl?.getBoundingClientRect() ?? block.getBoundingClientRect()
    setRect(focus)
    if (table) {
      const cell = getFocusedCell(table)
      if (cell) setActiveCol(cell.cellIndex)
    }
  }, [block, table])

  useEffect(() => {
    block.classList.add('doc-editor-block-active')
    updateRect()
    const onScroll = () => updateRect()
    window.addEventListener('scroll', onScroll, true)
    window.addEventListener('resize', onScroll)
    const obs = new ResizeObserver(() => updateRect())
    obs.observe(block)
    return () => {
      block.classList.remove('doc-editor-block-active')
      window.removeEventListener('scroll', onScroll, true)
      window.removeEventListener('resize', onScroll)
      obs.disconnect()
    }
  }, [block, updateRect])

  useEffect(() => {
    if (!table) return
    table.querySelectorAll('td, th').forEach((cell) => cell.classList.remove('doc-table-cell-active'))
    getFocusedCell(table)?.classList.add('doc-table-cell-active')
  })

  useEffect(() => {
    if (readOnly || !table) return
    const onMove = (e: MouseEvent) => {
      const drag = resizeRef.current
      if (!drag) return
      resizeColumn(table, drag.col, e.clientX - drag.startX)
      drag.startX = e.clientX
      updateRect()
      onChange()
    }
    const onUp = () => {
      resizeRef.current = null
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
    return () => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }
  }, [readOnly, table, onChange, updateRect])

  useEffect(() => {
    if (readOnly || blockType !== 'code') return
    const onMove = (e: MouseEvent) => {
      const drag = heightResizeRef.current
      if (!drag) return
      setCodeBlockMinHeight(block, drag.startH + (e.clientY - drag.startY))
      updateRect()
      onChange()
    }
    const onUp = () => {
      heightResizeRef.current = null
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
    return () => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }
  }, [readOnly, blockType, block, onChange, updateRect])

  useLayoutEffect(() => {
    if (!menuOpen || !menuAnchorRef.current || !menuRef.current) return
    const panel = menuRef.current
    const pos = clampMenuPosition(menuAnchorRef.current, panel.offsetWidth || PANEL_WIDTH, panel.offsetHeight, menuOpen)
    setMenuPos(pos)
  }, [menuOpen, blockType, readOnly])

  if (!rect) return null

  const headerRow = table?.rows[0]
  const colRects = headerRow ? Array.from(headerRow.cells).map((cell) => cell.getBoundingClientRect()) : []
  const activeColRect = colRects[activeCol]

  const openMenu = (kind: MenuKind, e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
    menuAnchorRef.current = (e.currentTarget as HTMLElement).getBoundingClientRect()
    setMenuOpen(kind)
  }

  const closeMenu = () => setMenuOpen(null)

  const runDuplicate = () => {
    closeMenu()
    if (readOnly) return
    duplicateEditorBlock(block)
    toast.success(`${blockLabel(blockType)} duplicated`)
    onChange()
  }

  const runCopyLink = async () => {
    closeMenu()
    try {
      await copyBlockLink(block, docId)
      toast.success('Block link copied')
    } catch {
      toast.error('Could not copy link')
    }
  }

  const runCopyContent = async () => {
    closeMenu()
    try {
      if (blockType === 'table') {
        await copyTableToClipboard(block)
        toast.success('Table copied')
      } else if (blockType === 'code') {
        await copyCodeToClipboard(block)
        toast.success('Code copied')
      } else {
        await copyImageToClipboard(block)
        toast.success('Image copied')
      }
    } catch {
      toast.error('Could not copy')
    }
  }

  const runExitCode = () => {
    closeMenu()
    if (readOnly || blockType !== 'code') return
    placeCaretAfterCodeBlock(block)
    onClose()
    onChange()
  }

  const runDelete = () => {
    closeMenu()
    if (readOnly) return
    deleteEditorBlock(block)
    onClose()
    toast.success(`${blockLabel(blockType)} deleted`)
    onChange()
  }

  const insertRow = () => {
    closeMenu()
    if (readOnly) return
    addRow(block)
    onChange()
    updateRect()
  }

  const insertColumn = (side: 'left' | 'right') => {
    closeMenu()
    if (readOnly) return
    const idx = side === 'left' ? Math.max(0, activeCol - 1) : activeCol
    addColumn(block, idx)
    onChange()
    updateRect()
  }

  const copyContentLabel =
    blockType === 'table' ? 'Copy table' : blockType === 'code' ? 'Copy code' : 'Copy image'
  const copyContentIcon =
    blockType === 'table' ? <Table2 size={15} /> : blockType === 'code' ? <Code2 size={15} /> : <ImageIcon size={15} />

  const overlay = (
    <div data-doc-block-chrome="block">
      <div
        className="pointer-events-none fixed z-[35] rounded-lg ring-1 ring-brand/50"
        style={{ top: rect.top - 2, left: rect.left - 2, width: rect.width + 4, height: rect.height + 4 }}
        aria-hidden
      />

      <button
        type="button"
        aria-label="Block options"
        onMouseDown={(e) => e.preventDefault()}
        onClick={(e) => openMenu('block', e)}
        style={{ top: rect.top + 8, left: rect.left - 30 }}
        className={cn(
          'fixed z-[36] flex h-6 w-6 items-center justify-center rounded-md text-fg-muted',
          'pointer-events-auto hover:bg-ink-750 hover:text-fg',
        )}
      >
        <GripVertical size={14} />
      </button>

      {blockType === 'table' && activeColRect && (
        <button
          type="button"
          aria-label="Column options"
          onMouseDown={(e) => e.preventDefault()}
          onClick={(e) => openMenu('column', e)}
          style={{
            top: activeColRect.top - 26,
            left: activeColRect.left + activeColRect.width / 2 - 10,
          }}
          className={cn(
            'fixed z-[36] flex h-5 w-5 items-center justify-center rounded text-fg-muted',
            'pointer-events-auto hover:bg-ink-750 hover:text-fg',
          )}
        >
          <GripHorizontal size={13} />
        </button>
      )}

      {blockType === 'table' &&
        !readOnly &&
        colRects.slice(0, -1).map((colRect, i) => (
          <div
            key={i}
            role="separator"
            aria-orientation="vertical"
            onMouseEnter={() => setHoverColEdge(i)}
            onMouseLeave={() => setHoverColEdge((v) => (v === i ? null : v))}
            onMouseDown={(e) => {
              e.preventDefault()
              e.stopPropagation()
              resizeRef.current = { col: i, startX: e.clientX }
            }}
            style={{
              top: colRect.top,
              left: colRect.right - 2,
              height: colRect.height,
            }}
            className={cn(
              'fixed z-[36] w-1 cursor-col-resize pointer-events-auto',
              hoverColEdge === i && 'bg-brand/50',
            )}
          />
        ))}

      {blockType === 'code' && !readOnly && (
        <div
          role="separator"
          aria-orientation="horizontal"
          aria-label="Resize code block"
          title="Drag to resize"
          onMouseDown={(e) => {
            e.preventDefault()
            e.stopPropagation()
            heightResizeRef.current = { startY: e.clientY, startH: block.offsetHeight }
          }}
          style={{
            top: rect.bottom - 4,
            left: rect.left + 8,
            width: Math.max(40, rect.width - 16),
          }}
          className="fixed z-[36] flex h-2 cursor-row-resize items-center justify-center pointer-events-auto"
        >
          <span className="h-1 w-10 rounded-full bg-ink-600 hover:bg-brand/70" />
        </div>
      )}

      {menuOpen && (
        <>
          <div className="fixed inset-0 z-[38]" onClick={closeMenu} aria-hidden />
          <div
            ref={menuRef}
            data-doc-block-chrome="block-menu"
            className="menu-panel fixed z-[39] max-h-[min(320px,calc(100vh-16px))] w-52 overflow-y-auto py-1"
            style={{
              top: menuPos.top,
              left: menuPos.left,
            }}
            onMouseDown={(e) => e.preventDefault()}
          >
            {menuOpen === 'column' && blockType === 'table' && !readOnly && (
              <>
                <MenuItem icon={<Plus size={14} />} label="Insert column left" onClick={() => insertColumn('left')} />
                <MenuItem icon={<Plus size={14} />} label="Insert column right" onClick={() => insertColumn('right')} />
                <div className="my-1 border-t border-ink-700" />
              </>
            )}
            {menuOpen === 'block' && blockType === 'table' && !readOnly && (
              <>
                <MenuItem icon={<Plus size={14} />} label="Insert row below" onClick={insertRow} />
                <div className="my-1 border-t border-ink-700" />
              </>
            )}
            {menuOpen === 'block' && blockType === 'code' && !readOnly && (
              <>
                <MenuItem icon={<CornerDownLeft size={14} />} label="Exit code block" onClick={runExitCode} />
                <div className="my-1 border-t border-ink-700" />
              </>
            )}
            <MenuItem icon={<Copy size={15} />} label="Duplicate" onClick={runDuplicate} disabled={readOnly} />
            <MenuItem icon={<Link2 size={15} />} label="Copy block link" onClick={() => void runCopyLink()} />
            <MenuItem icon={copyContentIcon} label={copyContentLabel} onClick={() => void runCopyContent()} />
            <div className="my-1 border-t border-ink-700" />
            <MenuItem icon={<Trash2 size={15} />} label="Delete" danger disabled={readOnly} onClick={runDelete} />
          </div>
        </>
      )}
    </div>
  )

  return createPortal(overlay, document.body)
}

function MenuItem({
  icon,
  label,
  onClick,
  danger,
  disabled,
}: {
  icon: React.ReactNode
  label: string
  onClick: () => void
  danger?: boolean
  disabled?: boolean
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      className={cn('menu-item w-full disabled:cursor-not-allowed disabled:opacity-50', danger && 'text-red-400 hover:text-red-300')}
      onClick={onClick}
    >
      {icon}
      {label}
    </button>
  )
}
