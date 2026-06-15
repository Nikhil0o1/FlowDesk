import { useQuery, useQueryClient } from '@tanstack/react-query'
import {
  ArrowLeft,
  Circle,
  MousePointer2,
  Square,
  StickyNote,
  Trash2,
  Type,
} from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'

import { api, errorMessage } from '../../lib/api'
import type { Whiteboard, WhiteboardElement } from '../../lib/types'
import { cn } from '../../lib/utils'
import { useRealtime } from '../../lib/ws'
import { useAuthStore } from '../../stores/auth'
import { toast } from '../../stores/toast'
import { CenteredSpinner } from '../../components/ui/Spinner'

type Tool = 'select' | 'sticky' | 'text' | 'rect' | 'ellipse'

const STICKY_COLORS = ['#FDE68A', '#FCA5A5', '#A7F3D0', '#BFDBFE', '#DDD6FE', '#FBCFE8']
const SHAPE_COLOR = '#8C5BFF'

let elementSeq = Date.now()
const newId = () => `el-${(elementSeq++).toString(36)}`

export default function WhiteboardCanvasPage() {
  const { whiteboardId } = useParams<{ whiteboardId: string }>()
  const navigate = useNavigate()
  const queryClient = useQueryClient()

  const { data: board, isLoading } = useQuery({
    queryKey: ['whiteboard', whiteboardId],
    queryFn: () => api.get<Whiteboard>(`/whiteboards/${whiteboardId}`),
    enabled: !!whiteboardId,
    staleTime: Infinity,
  })

  const [elements, setElements] = useState<WhiteboardElement[] | null>(null)
  const [name, setName] = useState('')
  const [tool, setTool] = useState<Tool>('select')
  const [color, setColor] = useState(STICKY_COLORS[0])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [saveState, setSaveState] = useState<'saved' | 'saving' | 'dirty'>('saved')

  const dragRef = useRef<{ id: string; mode: 'move' | 'resize'; startX: number; startY: number; orig: WhiteboardElement } | null>(null)
  const saveTimer = useRef<number | null>(null)
  const latest = useRef<WhiteboardElement[]>([])

  // hydrate local state once loaded
  useEffect(() => {
    if (board && elements === null) {
      setElements(board.content?.elements ?? [])
      setName(board.name)
    }
  }, [board, elements])

  useEffect(() => {
    if (elements) latest.current = elements
  }, [elements])

  // Live updates from other users: refetch and swap in the remote scene,
  // unless we have unsaved local edits (those would win on the next save).
  const user = useAuthStore((s) => s.user)
  const saveStateRef = useRef(saveState)
  useEffect(() => {
    saveStateRef.current = saveState
  }, [saveState])
  useRealtime(
    'whiteboard.updated',
    (event) => {
      if (event.payload.whiteboard_id !== whiteboardId) return
      if (event.payload.actor_id === user?.id) return
      if (saveStateRef.current !== 'saved') return
      void api.get<Whiteboard>(`/whiteboards/${whiteboardId}`).then((fresh) => {
        queryClient.setQueryData(['whiteboard', whiteboardId], fresh)
        setElements(fresh.content?.elements ?? [])
        setName(fresh.name)
      })
    },
    [whiteboardId, user?.id],
  )

  const persist = useCallback(async () => {
    setSaveState('saving')
    try {
      await api.patch(`/whiteboards/${whiteboardId}`, { content: { elements: latest.current } })
      setSaveState('saved')
      void queryClient.invalidateQueries({ queryKey: ['whiteboards'] })
    } catch (err) {
      setSaveState('dirty')
      toast.error(errorMessage(err))
    }
  }, [whiteboardId, queryClient])

  const markDirty = useCallback(() => {
    setSaveState('dirty')
    if (saveTimer.current) window.clearTimeout(saveTimer.current)
    saveTimer.current = window.setTimeout(() => void persist(), 900)
  }, [persist])

  const updateElements = useCallback(
    (updater: (prev: WhiteboardElement[]) => WhiteboardElement[]) => {
      setElements((prev) => (prev ? updater(prev) : prev))
      markDirty()
    },
    [markDirty],
  )

  const renameBoard = async () => {
    if (!name.trim() || name.trim() === board?.name) return
    try {
      await api.patch(`/whiteboards/${whiteboardId}`, { name: name.trim() })
      void queryClient.invalidateQueries({ queryKey: ['whiteboards'] })
    } catch (err) {
      toast.error(errorMessage(err))
    }
  }

  const addElement = (x: number, y: number) => {
    const base = { id: newId(), x: Math.round(x), y: Math.round(y), text: '' }
    let element: WhiteboardElement
    if (tool === 'sticky') element = { ...base, type: 'sticky', w: 170, h: 140, color, text: '' }
    else if (tool === 'text') element = { ...base, type: 'text', w: 220, h: 40, color: '#ECECEE', text: 'Text' }
    else if (tool === 'rect') element = { ...base, type: 'rect', w: 180, h: 110, color: SHAPE_COLOR, text: '' }
    else element = { ...base, type: 'ellipse', w: 150, h: 110, color: SHAPE_COLOR, text: '' }
    updateElements((prev) => [...prev, element])
    setSelectedId(element.id)
    setTool('select')
    if (element.type === 'sticky' || element.type === 'text') setEditingId(element.id)
  }

  const deleteSelected = useCallback(() => {
    if (!selectedId) return
    updateElements((prev) => prev.filter((e) => e.id !== selectedId))
    setSelectedId(null)
    setEditingId(null)
  }, [selectedId, updateElements])

  // keyboard delete
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.key === 'Delete' || e.key === 'Backspace') && selectedId && !editingId) {
        e.preventDefault()
        deleteSelected()
      }
      if (e.key === 'Escape') {
        setEditingId(null)
        setSelectedId(null)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [selectedId, editingId, deleteSelected])

  // drag move / resize
  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      const drag = dragRef.current
      if (!drag) return
      const dx = e.clientX - drag.startX
      const dy = e.clientY - drag.startY
      updateElements((prev) =>
        prev.map((el) => {
          if (el.id !== drag.id) return el
          if (drag.mode === 'move') {
            return { ...el, x: Math.max(0, drag.orig.x + dx), y: Math.max(0, drag.orig.y + dy) }
          }
          return { ...el, w: Math.max(60, drag.orig.w + dx), h: Math.max(40, drag.orig.h + dy) }
        }),
      )
    }
    const onUp = () => {
      dragRef.current = null
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
    return () => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }
  }, [updateElements])

  if (isLoading || elements === null) return <CenteredSpinner />
  if (!board) return <p className="p-8 text-sm text-fg-secondary">Whiteboard not found.</p>

  const selected = elements.find((e) => e.id === selectedId)

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <div className="flex shrink-0 items-center gap-2 border-b border-ink-700 px-4 py-2.5">
        <button className="btn-ghost !px-2" onClick={() => navigate('/app/whiteboards')}>
          <ArrowLeft size={16} />
        </button>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          onBlur={renameBoard}
          onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
          className="w-64 rounded-lg border border-transparent bg-transparent px-2 py-1 text-sm font-semibold text-fg outline-none transition-colors hover:border-ink-700 focus:border-brand focus:bg-ink-800"
        />
        <span className="flex-1" />
        <span className={cn('text-xs', saveState === 'saved' ? 'text-fg-muted' : 'text-amber-400')}>
          {saveState === 'saved' ? 'Saved' : saveState === 'saving' ? 'Saving…' : 'Unsaved changes'}
        </span>
      </div>

      <div className="relative min-h-0 flex-1">
        {/* Toolbar */}
        <div className="absolute left-4 top-4 z-20 flex flex-col gap-1 rounded-xl border border-ink-700 bg-ink-850 p-1.5 shadow-popover">
          <ToolButton active={tool === 'select'} onClick={() => setTool('select')} title="Select (Esc)">
            <MousePointer2 size={16} />
          </ToolButton>
          <ToolButton active={tool === 'sticky'} onClick={() => setTool('sticky')} title="Sticky note">
            <StickyNote size={16} />
          </ToolButton>
          <ToolButton active={tool === 'text'} onClick={() => setTool('text')} title="Text">
            <Type size={16} />
          </ToolButton>
          <ToolButton active={tool === 'rect'} onClick={() => setTool('rect')} title="Rectangle">
            <Square size={16} />
          </ToolButton>
          <ToolButton active={tool === 'ellipse'} onClick={() => setTool('ellipse')} title="Ellipse">
            <Circle size={16} />
          </ToolButton>
          <div className="my-0.5 h-px bg-ink-700" />
          {STICKY_COLORS.map((c) => (
            <button
              key={c}
              onClick={() => {
                setColor(c)
                if (selected && selected.type === 'sticky') {
                  updateElements((prev) => prev.map((el) => (el.id === selected.id ? { ...el, color: c } : el)))
                }
              }}
              className={cn('mx-auto h-5 w-5 rounded-md transition-transform', color === c && 'scale-110 ring-2 ring-white/50')}
              style={{ backgroundColor: c }}
              title="Color"
            />
          ))}
          <div className="my-0.5 h-px bg-ink-700" />
          <ToolButton active={false} onClick={deleteSelected} title="Delete selected" disabled={!selected}>
            <Trash2 size={16} className={selected ? 'text-red-400' : ''} />
          </ToolButton>
        </div>

        {/* Canvas */}
        <div className="h-full w-full overflow-auto">
          <div
            className={cn('relative', tool !== 'select' ? 'cursor-crosshair' : 'cursor-default')}
            style={{
              width: 3000,
              height: 2000,
              backgroundImage: 'radial-gradient(circle, rgba(255,255,255,0.06) 1px, transparent 1px)',
              backgroundSize: '20px 20px',
            }}
            onMouseDown={(e) => {
              if (e.target !== e.currentTarget) return
              if (tool === 'select') {
                setSelectedId(null)
                setEditingId(null)
                return
              }
              const rect = e.currentTarget.getBoundingClientRect()
              addElement(e.clientX - rect.left, e.clientY - rect.top)
            }}
          >
            {elements.map((element) => (
              <CanvasElement
                key={element.id}
                element={element}
                selected={element.id === selectedId}
                editing={element.id === editingId}
                onSelect={() => {
                  setSelectedId(element.id)
                  setEditingId(null)
                }}
                onStartDrag={(e, mode) => {
                  setSelectedId(element.id)
                  dragRef.current = {
                    id: element.id,
                    mode,
                    startX: e.clientX,
                    startY: e.clientY,
                    orig: element,
                  }
                }}
                onEdit={() => setEditingId(element.id)}
                onText={(text) =>
                  updateElements((prev) => prev.map((el) => (el.id === element.id ? { ...el, text } : el)))
                }
                onDoneEditing={() => setEditingId(null)}
              />
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}

function ToolButton({
  active,
  onClick,
  title,
  disabled,
  children,
}: {
  active: boolean
  onClick: () => void
  title: string
  disabled?: boolean
  children: React.ReactNode
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      title={title}
      className={cn(
        'flex h-8 w-8 items-center justify-center rounded-lg transition-colors disabled:opacity-40',
        active ? 'bg-brand text-white' : 'text-fg-secondary hover:bg-ink-750 hover:text-fg',
      )}
    >
      {children}
    </button>
  )
}

function CanvasElement({
  element,
  selected,
  editing,
  onSelect,
  onStartDrag,
  onEdit,
  onText,
  onDoneEditing,
}: {
  element: WhiteboardElement
  selected: boolean
  editing: boolean
  onSelect: () => void
  onStartDrag: (e: React.MouseEvent, mode: 'move' | 'resize') => void
  onEdit: () => void
  onText: (text: string) => void
  onDoneEditing: () => void
}) {
  const isShape = element.type === 'rect' || element.type === 'ellipse'
  return (
    <div
      className={cn('absolute select-none', selected && 'z-10')}
      style={{ left: element.x, top: element.y, width: element.w, height: element.h }}
      onMouseDown={(e) => {
        e.stopPropagation()
        if (!editing) {
          onSelect()
          onStartDrag(e, 'move')
        }
      }}
      onDoubleClick={(e) => {
        e.stopPropagation()
        if (element.type === 'sticky' || element.type === 'text') onEdit()
      }}
    >
      {/* Body */}
      {element.type === 'sticky' && (
        <div
          className="h-full w-full overflow-hidden rounded-lg p-2.5 text-sm text-gray-900 shadow-[0_4px_14px_rgba(0,0,0,0.45)]"
          style={{ backgroundColor: element.color }}
        >
          {editing ? (
            <textarea
              autoFocus
              defaultValue={element.text}
              onBlur={(e) => {
                onText(e.target.value)
                onDoneEditing()
              }}
              onMouseDown={(e) => e.stopPropagation()}
              className="h-full w-full resize-none bg-transparent text-sm text-gray-900 outline-none"
            />
          ) : (
            <p className="whitespace-pre-wrap break-words text-sm leading-snug">
              {element.text || <span className="opacity-40">Double-click to edit</span>}
            </p>
          )}
        </div>
      )}

      {element.type === 'text' &&
        (editing ? (
          <textarea
            autoFocus
            defaultValue={element.text}
            onBlur={(e) => {
              onText(e.target.value)
              onDoneEditing()
            }}
            onMouseDown={(e) => e.stopPropagation()}
            className="h-full w-full resize-none rounded border border-brand bg-ink-850 p-1 text-base font-medium text-fg outline-none"
          />
        ) : (
          <p className="whitespace-pre-wrap break-words text-base font-medium" style={{ color: element.color }}>
            {element.text || <span className="text-fg-muted">Double-click to edit</span>}
          </p>
        ))}

      {isShape && (
        <div
          className={cn('h-full w-full border-2', element.type === 'ellipse' && 'rounded-full')}
          style={{ borderColor: element.color, backgroundColor: `${element.color}1A`, borderRadius: element.type === 'rect' ? 10 : undefined }}
        />
      )}

      {/* Selection outline + resize handle */}
      {selected && (
        <>
          <div className="pointer-events-none absolute -inset-1 rounded-lg border border-brand" />
          <div
            className="absolute -bottom-1.5 -right-1.5 h-3 w-3 cursor-nwse-resize rounded-sm border border-ink-900 bg-brand"
            onMouseDown={(e) => {
              e.stopPropagation()
              onStartDrag(e, 'resize')
            }}
          />
        </>
      )}
    </div>
  )
}
