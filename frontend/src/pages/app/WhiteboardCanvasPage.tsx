import { useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowLeft, FileDown } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'

import {
  CaptureUpdateAction,
  Excalidraw,
  MainMenu,
  exportToBlob,
  getSceneVersion,
} from '@excalidraw/excalidraw'
import '@excalidraw/excalidraw/index.css'

import { api, errorMessage } from '../../lib/api'
import { API_BASE } from '../../lib/env'
import type { Whiteboard } from '../../lib/types'
import {
  boardElementsSignature,
  mergeElementsByVersion,
  restoreBoardScene,
} from '../../lib/whiteboardScene'
import { cn } from '../../lib/utils'
import { realtime, useRealtime } from '../../lib/ws'
import { displayName, useAuthStore } from '../../stores/auth'
import { toast } from '../../stores/toast'
import { CenteredSpinner } from '../../components/ui/Spinner'

const CURSOR_COLORS = ['#4f8bff', '#22c55e', '#f59e0b', '#ec4899', '#a855f7', '#06b6d4', '#ef4444', '#14b8a6']
const colorForUser = (id: string) => {
  let h = 0
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0
  return CURSOR_COLORS[h % CURSOR_COLORS.length]
}

export default function WhiteboardCanvasPage() {
  const { whiteboardId } = useParams<{ whiteboardId: string }>()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const user = useAuthStore((s) => s.user)

  const { data: board, isLoading } = useQuery({
    queryKey: ['whiteboard', whiteboardId],
    queryFn: () => api.get<Whiteboard>(`/whiteboards/${whiteboardId}`),
    enabled: !!whiteboardId,
    staleTime: Infinity,
    // Always pull the latest stored scene when (re)opening the board, but never
    // on window focus — that would interrupt an in-progress edit.
    refetchOnMount: 'always',
    refetchOnWindowFocus: false,
  })

  const apiRef = useRef<any>(null)
  const [name, setName] = useState('')
  const [saveState, setSaveState] = useState<'saved' | 'saving' | 'dirty'>('saved')

  // ---- persistence refs (reset when switching boards) ----
  const sceneRef = useRef<{ elements: readonly any[]; files: any; appState: any }>({
    elements: [],
    files: {},
    appState: {},
  })
  const dirtyRef = useRef(false)
  const loadedRef = useRef(false)
  const sawNonEmptyRef = useRef(false)
  const saveTimer = useRef<number | null>(null)
  const lastVersion = useRef(0)
  const appliedSig = useRef('')
  const activeBoardId = useRef<string | undefined>(whiteboardId)
  const knownFileIds = useRef<Set<string>>(new Set())
  const collaborators = useRef<Map<string, any>>(new Map())

  // Isolate each board: Excalidraw + session state must not leak across navigations.
  useEffect(() => {
    if (!whiteboardId || activeBoardId.current === whiteboardId) return
    activeBoardId.current = whiteboardId
    appliedSig.current = ''
    sceneRef.current = { elements: [], files: {}, appState: {} }
    dirtyRef.current = false
    loadedRef.current = false
    sawNonEmptyRef.current = false
    lastVersion.current = 0
    knownFileIds.current.clear()
    collaborators.current.clear()
    if (saveTimer.current) {
      window.clearTimeout(saveTimer.current)
      saveTimer.current = null
    }
    setSaveState('saved')
  }, [whiteboardId])

  useEffect(() => {
    if (board) setName(board.name)
  }, [board])

  // Same-board only: merge server refetches by element version. Never merge across
  // boards — that stacked every previous canvas onto the next one.
  useEffect(() => {
    const ex = apiRef.current
    if (!ex || !board?.content || !whiteboardId || board.id !== whiteboardId) return
    const remote = (board.content.elements as any[]) ?? []
    const sig = boardElementsSignature(whiteboardId, remote)
    if (sig === appliedSig.current) return
    appliedSig.current = sig
    if (board.content.files) ex.addFiles(Object.values(board.content.files) as any)
    const merged = mergeElementsByVersion(ex.getSceneElementsIncludingDeleted(), remote)
    ex.updateScene({ elements: merged, captureUpdate: CaptureUpdateAction.NEVER })
  }, [board?.content, board?.id, whiteboardId])

  const initialData = useMemo(() => {
    if (!board || board.id !== whiteboardId) return null
    return restoreBoardScene(board.content)
  }, [board, whiteboardId])

  // ---- persistence ----

  const buildContent = useCallback(() => {
    const s = sceneRef.current
    return {
      elements: (s.elements as any[]).filter((e) => e && !e.isDeleted),
      appState: { viewBackgroundColor: s.appState?.viewBackgroundColor, gridSize: s.appState?.gridSize },
      files: s.files || {},
    }
  }, [])

  // Guard against wiping a stored board with a spurious empty scene (e.g. an
  // early change event before the saved scene has mounted). An empty save is
  // only allowed once the canvas has actually held content this session — i.e.
  // the user genuinely cleared it.
  const wouldWipeStored = useCallback(
    (content: { elements: unknown[] }) => {
      if (content.elements.length > 0 || sawNonEmptyRef.current) return false
      const cached = queryClient.getQueryData<Whiteboard>(['whiteboard', whiteboardId])
      return ((cached?.content?.elements as unknown[] | undefined)?.length ?? 0) > 0
    },
    [queryClient, whiteboardId],
  )

  const persist = useCallback(async () => {
    // Never overwrite stored data before the board has loaded, and skip no-op
    // saves. dirtyRef is only ever set from a real edit (onChange), so we can't
    // clobber a populated board with the empty default scene.
    if (!loadedRef.current || !dirtyRef.current) return
    const content = buildContent()
    if (wouldWipeStored(content)) return
    dirtyRef.current = false
    setSaveState('saving')
    try {
      await api.patch(`/whiteboards/${whiteboardId}`, { content })
      setSaveState('saved')
      // Keep the detail cache in sync so re-opening shows the saved scene
      // immediately instead of a stale (reset-looking) one.
      queryClient.setQueryData(['whiteboard', whiteboardId], (old: any) => (old ? { ...old, content } : old))
      void queryClient.invalidateQueries({ queryKey: ['whiteboards'] })
    } catch (err) {
      dirtyRef.current = true
      setSaveState('dirty')
      toast.error(errorMessage(err))
    }
  }, [whiteboardId, queryClient, buildContent, wouldWipeStored])

  const scheduleSave = useCallback(() => {
    dirtyRef.current = true
    setSaveState('dirty')
    if (saveTimer.current) window.clearTimeout(saveTimer.current)
    saveTimer.current = window.setTimeout(() => {
      saveTimer.current = null
      void persist()
    }, 600)
  }, [persist])

  // Best-effort save for tab close / refresh / backgrounding. A keepalive
  // request survives page unload; sendBeacon can't carry our bearer token.
  const flushOnExit = useCallback(() => {
    if (!loadedRef.current || !dirtyRef.current) return
    const content = buildContent()
    if (wouldWipeStored(content)) return
    dirtyRef.current = false
    const token = useAuthStore.getState().accessToken
    try {
      void fetch(`${API_BASE}/whiteboards/${whiteboardId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        credentials: 'include',
        keepalive: true,
        body: JSON.stringify({ content }),
      })
    } catch {
      /* best effort */
    }
  }, [whiteboardId, buildContent, wouldWipeStored])

  useEffect(() => {
    const onHide = () => flushOnExit()
    const onVisibility = () => document.visibilityState === 'hidden' && flushOnExit()
    window.addEventListener('pagehide', onHide)
    document.addEventListener('visibilitychange', onVisibility)
    return () => {
      window.removeEventListener('pagehide', onHide)
      document.removeEventListener('visibilitychange', onVisibility)
    }
  }, [flushOnExit])

  // Flush a pending save when leaving the board (SPA navigation). Reads the
  // captured scene ref, so it is correct even though <Excalidraw> is being
  // unmounted at the same moment.
  useEffect(
    () => () => {
      if (saveTimer.current) window.clearTimeout(saveTimer.current)
      void persist()
    },
    [persist],
  )

  // ---- multiplayer ----
  const lastBroadcast = useRef(0)
  const broadcastTimer = useRef<number | null>(null)

  const doBroadcastScene = useCallback(() => {
    const ex = apiRef.current
    if (!ex) return
    const files = ex.getFiles() || {}
    const fileIds = Object.keys(files)
    const includeFiles = fileIds.some((id) => !knownFileIds.current.has(id))
    fileIds.forEach((id) => knownFileIds.current.add(id))
    realtime.send({
      type: 'whiteboard.scene',
      whiteboard_id: whiteboardId,
      payload: {
        elements: ex.getSceneElementsIncludingDeleted(),
        ...(includeFiles ? { files } : {}),
      },
    })
  }, [whiteboardId])

  const scheduleBroadcast = useCallback(() => {
    const now = Date.now()
    const elapsed = now - lastBroadcast.current
    if (elapsed >= 150) {
      lastBroadcast.current = now
      doBroadcastScene()
    } else if (!broadcastTimer.current) {
      broadcastTimer.current = window.setTimeout(() => {
        broadcastTimer.current = null
        lastBroadcast.current = Date.now()
        doBroadcastScene()
      }, 150 - elapsed)
    }
  }, [doBroadcastScene])

  const onChange = useCallback(
    (elements: readonly any[], appState: any, files: any) => {
      // Always capture the freshest scene so a save (including the unmount /
      // tab-close flush) writes real data, never a torn-down empty canvas.
      sceneRef.current = {
        elements,
        appState,
        files: { ...sceneRef.current.files, ...(files || {}) },
      }
      loadedRef.current = true
      if ((elements as any[]).some((e) => e && !e.isDeleted)) sawNonEmptyRef.current = true
      const v = getSceneVersion(elements as any)
      if (v === lastVersion.current) return // ignore selection/scroll-only changes
      lastVersion.current = v
      scheduleSave()
      scheduleBroadcast()
    },
    [scheduleSave, scheduleBroadcast],
  )

  // Subscribe to the board's collab room (re-sent periodically to survive WS reconnects)
  useEffect(() => {
    if (!whiteboardId) return
    const sub = () => realtime.send({ type: 'whiteboard.subscribe', whiteboard_id: whiteboardId })
    sub()
    const iv = window.setInterval(sub, 10000)
    return () => window.clearInterval(iv)
  }, [whiteboardId])

  // Remote scene updates → reconcile by version
  useRealtime(
    'whiteboard.scene',
    (event) => {
      if (event.whiteboard_id !== whiteboardId || event.payload.user_id === user?.id) return
      const ex = apiRef.current
      if (!ex) return
      if (event.payload.files) ex.addFiles(Object.values(event.payload.files))
      const merged = mergeElementsByVersion(ex.getSceneElementsIncludingDeleted(), event.payload.elements ?? [])
      ex.updateScene({ elements: merged, captureUpdate: CaptureUpdateAction.NEVER })
    },
    [whiteboardId, user?.id],
  )

  // Remote cursors
  const flushCollaborators = useCallback(() => {
    apiRef.current?.updateScene({ collaborators: new Map(collaborators.current) as any })
  }, [])
  useRealtime(
    'whiteboard.cursor',
    (event) => {
      if (event.whiteboard_id !== whiteboardId || event.payload.user_id === user?.id) return
      const id = event.payload.user_id
      collaborators.current.set(id, {
        id,
        username: event.payload.username || 'Teammate',
        pointer: { x: event.payload.x, y: event.payload.y },
        button: event.payload.button || 'up',
        color: { background: event.payload.color || '#4f8bff', stroke: event.payload.color || '#4f8bff' },
        lastSeen: Date.now(),
      })
      flushCollaborators()
    },
    [whiteboardId, user?.id],
  )

  // prune cursors that went quiet
  useEffect(() => {
    const iv = window.setInterval(() => {
      const cutoff = Date.now() - 15000
      let changed = false
      for (const [id, c] of collaborators.current) {
        if (c.lastSeen < cutoff) {
          collaborators.current.delete(id)
          changed = true
        }
      }
      if (changed) flushCollaborators()
    }, 5000)
    return () => window.clearInterval(iv)
  }, [flushCollaborators])

  const lastPointer = useRef(0)
  const onPointerUpdate = useCallback(
    (payload: { pointer: { x: number; y: number }; button: 'down' | 'up' }) => {
      const now = Date.now()
      if (now - lastPointer.current < 60) return
      lastPointer.current = now
      realtime.send({
        type: 'whiteboard.cursor',
        whiteboard_id: whiteboardId,
        payload: {
          x: payload.pointer.x,
          y: payload.pointer.y,
          button: payload.button,
          username: displayName(user),
          color: user ? colorForUser(user.id) : '#4f8bff',
        },
      })
    },
    [whiteboardId, user],
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

  const exportPdf = useCallback(async () => {
    const ex = apiRef.current
    if (!ex) return
    try {
      const blob = await exportToBlob({
        elements: ex.getSceneElements(),
        appState: ex.getAppState(),
        files: ex.getFiles(),
        mimeType: 'image/png',
        quality: 1,
      })
      const dataUrl: string = await new Promise((res, rej) => {
        const r = new FileReader()
        r.onload = () => res(r.result as string)
        r.onerror = rej
        r.readAsDataURL(blob)
      })
      const img = new Image()
      img.src = dataUrl
      await img.decode()
      const { jsPDF } = await import('jspdf')
      const pdf = new jsPDF({
        orientation: img.width >= img.height ? 'landscape' : 'portrait',
        unit: 'px',
        format: [img.width, img.height],
      })
      pdf.addImage(dataUrl, 'PNG', 0, 0, img.width, img.height)
      pdf.save(`${name || 'whiteboard'}.pdf`)
    } catch (err) {
      toast.error(errorMessage(err))
    }
  }, [name])

  if (isLoading || !board) return <CenteredSpinner />

  return (
    <div className="flex h-full flex-col">
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
        <Excalidraw
          key={whiteboardId}
          excalidrawAPI={(ex) => (apiRef.current = ex)}
          initialData={initialData}
          onChange={onChange}
          onPointerUpdate={onPointerUpdate}
          theme="dark"
          UIOptions={{ canvasActions: { loadScene: false } }}
        >
          <MainMenu>
            <MainMenu.DefaultItems.SaveAsImage />
            <MainMenu.Item icon={<FileDown size={16} />} onSelect={() => void exportPdf()}>
              Export as PDF
            </MainMenu.Item>
            <MainMenu.DefaultItems.ChangeCanvasBackground />
            <MainMenu.Separator />
            <MainMenu.DefaultItems.ClearCanvas />
            <MainMenu.DefaultItems.ToggleTheme />
          </MainMenu>
        </Excalidraw>
      </div>
    </div>
  )
}
