import { Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  ArchiveRestore,
  FileQuestion,
  Loader2,
  Lock,
  MoreHorizontal,
  Settings,
  Share2,
} from 'lucide-react'
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom'

import { Avatar } from '../../../components/ui/Avatar'
import { realtime, useRealtime } from '../../../lib/ws'
import { cn, timeAgo } from '../../../lib/utils'
import { useCurrentContext } from '../../../lib/queries'
import { EmptyState } from '../../../components/ui/EmptyState'
import { Dropdown } from '../../../components/ui/Dropdown'
import { displayName, useAuthStore } from '../../../stores/auth'
import { toast } from '../../../stores/toast'
import { useDocs } from '../context/DocsContext'
import { useArchive } from '../hooks/useArchive'
import { useComments } from '../hooks/useComments'
import { useDocumentQuery } from '../hooks/useDocuments'
import { colorForUser, usePresence } from '../hooks/usePresence'
import { usePermissions } from '../hooks/usePermissions'
import { useSharing } from '../hooks/useSharing'
import { useActivity } from '../hooks/useActivity'
import { nextContentStamp, shouldApplyRemoteContent } from '../lib/docCollab'
import { publishDocContent, publishDocCursor, subscribeDocRoom } from '../services/collaboration.ws'
import { notifyDocumentBodyMentionApi, openDocumentApi } from '../services/docsApi.service'
import { isArchived as isArchivedDoc } from '../services/docs.service'
import type { DocToolbarPosition, EditorApi, SaveStatus } from '../types/editor'
import type { RightSidebarTab } from '../types/collaboration'
import type { DocInsertBlock, DocPageSettings } from '../types/pageSettings'
import { DEFAULT_PAGE_SETTINGS } from '../types/pageSettings'
import type { DocEditorHandle } from '../components/DocEditor/DocEditor'
import { DocToolbar } from '../components/DocToolbar/DocToolbar'

const TOOLBAR_POS_KEY = 'flowdesk.docs.toolbarPosition'

function readToolbarPosition(): DocToolbarPosition {
  try {
    return localStorage.getItem(TOOLBAR_POS_KEY) === 'top' ? 'top' : 'floating'
  } catch {
    return 'floating'
  }
}
import { DocsBreadcrumb, type Crumb } from '../components/DocsBreadcrumb'
import { DocCoverBanner } from '../components/DocPage/DocCoverBanner'
import { DocLinkedChips } from '../components/DocPage/DocLinkedChips'
import { DocPageRail } from '../components/DocPage/DocPageRail'
import { DocPageToolbar } from '../components/DocPage/DocPageToolbar'
import {
  pageFocusClasses,
  pageSettingsTypography,
  pageSettingsWidth,
} from '../components/DocPage/PageStylesPanel'
import { computeDocStats, formatReadingTime } from '../utils/docStats'
import { PermissionBadge } from '../components/Permissions/PermissionBadge'
import { PresenceStack } from '../components/Presence/PresenceStack'
import { RightSidebar } from '../components/RightSidebar/RightSidebar'
import { ShareDocumentModal, type ShareScope } from '../components/Sharing/ShareDocumentModal'
import { DocSettingsModal } from '../components/Settings/DocSettingsModal'

const DocEditor = lazy(() => import('../components/DocEditor/DocEditor'))

/** Persist durability separately from live collab (whiteboard uses 600ms). */
const SAVE_DEBOUNCE_MS = 800
/** Live HTML fan-out — tighter than whiteboard scene so typing feels instant. */
const CONTENT_BROADCAST_MS = 50
const CURSOR_BROADCAST_MS = 45
/** While actively typing, hold remote applies briefly so local keystrokes aren't stolen. */
const LOCAL_EDIT_HOLD_MS = 180

function tabFromPath(pathname: string, documentId: string): RightSidebarTab | null {
  const base = `/app/docs/${documentId}`
  if (pathname === `${base}/comments`) return 'comments'
  if (pathname === `${base}/styles`) return 'styles'
  if (pathname === `${base}/links`) return 'links'
  if (pathname === `${base}/history`) return 'history'
  if (pathname === `${base}/activity`) return 'activity'
  if (pathname === `${base}/share`) return null
  return null
}

export default function DocumentPage() {
  const { documentId = '' } = useParams()
  const location = useLocation()
  const navigate = useNavigate()
  const user = useAuthStore((s) => s.user)
  const { workspace } = useCurrentContext()
  const workspaceName = workspace?.name ?? 'FlowDesk'
  const { getDocument, updateDocument, folderPath, createDocument, activeDocuments } = useDocs()
  const { unarchive } = useArchive()

  const cachedDoc = getDocument(documentId)
  const docQuery = useDocumentQuery(documentId)
  const doc = cachedDoc ?? docQuery.data
  const docLoading = !doc && (docQuery.isLoading || docQuery.isFetching)

  const { role, canEdit, canComment, canShare } = usePermissions(documentId, doc?.author, doc?.authorId)
  useSharing(documentId, doc?.title ?? '', doc?.author, doc?.authorId)
  const { viewers } = usePresence(documentId)
  const { count: commentCount } = useComments(documentId, doc?.title ?? '')
  const { events } = useActivity(documentId)

  const archived = !!doc && isArchivedDoc(doc)
  const lockedByProtection = !!doc?.isProtected && role !== 'owner'
  const readOnly = archived || !canEdit || lockedByProtection

  const routeTab = tabFromPath(location.pathname, documentId)
  const [sidebarTab, setSidebarTab] = useState<RightSidebarTab>(routeTab ?? 'comments')
  const [showSidebar, setShowSidebar] = useState(!!routeTab)
  const [showShare, setShowShare] = useState(location.pathname.endsWith('/share'))
  const [shareScope, setShareScope] = useState<ShareScope>('doc')
  const [showSettings, setShowSettings] = useState(false)
  const [settingsTab, setSettingsTab] = useState<'doc' | 'page'>('doc')
  const [editorReloadKey, setEditorReloadKey] = useState(0)
  /** Seed HTML only after hydrate for the route doc — avoids seeding linked docs with the previous page's body. */
  const [editorSeed, setEditorSeed] = useState<{ docId: string; content: string } | null>(null)
  const [pendingInline, setPendingInline] = useState<{ markerId: string; quote: string } | null>(null)

  const [title, setTitle] = useState('')
  const [pageSettings, setPageSettings] = useState<DocPageSettings>(DEFAULT_PAGE_SETTINGS)
  const [coverUrl, setCoverUrl] = useState<string | null>(null)
  const [docIcon, setDocIcon] = useState<string | null>(null)
  const [isWiki, setIsWiki] = useState(false)
  const [saveState, setSaveState] = useState<SaveStatus>('saved')
  const titleRef = useRef('')
  const contentRef = useRef('')
  /** Last accepted content stamp (local edit or applied remote). */
  const contentStampRef = useRef({ version: 0, userId: user?.id ?? '' })
  const lastLocalEditAt = useRef(0)
  const editorRef = useRef<DocEditorHandle>(null)
  const [editorApi, setEditorApi] = useState<EditorApi | null>(null)
  const [toolbarPosition, setToolbarPosition] = useState<DocToolbarPosition>(readToolbarPosition)

  const onToolbarPositionChange = useCallback((value: DocToolbarPosition) => {
    try {
      localStorage.setItem(TOOLBAR_POS_KEY, value)
    } catch {
      /* ignore */
    }
    setToolbarPosition(value)
  }, [])
  const titleInputRef = useRef<HTMLInputElement>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const settingsTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const broadcastTimer = useRef<number | null>(null)
  const lastBroadcast = useRef(0)
  const lastCursorBroadcast = useRef(0)
  const pendingRemote = useRef<{ html: string; version: number; userId: string } | null>(null)
  const remoteApplyTimer = useRef<number | null>(null)
  const loggedCreate = useRef(false)
  const hydratedDocId = useRef('')
  const readOnlyRef = useRef(readOnly)
  const saveStateRef = useRef(saveState)
  const pageSettingsRef = useRef(pageSettings)
  const updateDocumentRef = useRef(updateDocument)
  readOnlyRef.current = readOnly
  saveStateRef.current = saveState
  pageSettingsRef.current = pageSettings
  updateDocumentRef.current = updateDocument

  useEffect(() => {
    if (!doc || doc.id !== documentId) return
    // Full hydrate only when opening a different document — avoid REST/query
    // refetches clobbering live collaborative HTML in the open editor.
    if (hydratedDocId.current !== documentId) {
      hydratedDocId.current = documentId
      const nextContent = doc.content ?? ''
      setTitle(doc.title ?? '')
      setPageSettings({ ...DEFAULT_PAGE_SETTINGS, ...(doc.pageSettings ?? {}) })
      setCoverUrl(doc.coverUrl ?? null)
      setDocIcon(doc.icon ?? null)
      setIsWiki(!!doc.isWiki)
      titleRef.current = doc.title ?? ''
      contentRef.current = nextContent
      contentStampRef.current = { version: 0, userId: user?.id ?? '' }
      lastLocalEditAt.current = 0
      pendingRemote.current = null
      setEditorApi(null)
      setEditorSeed({ docId: documentId, content: nextContent })
      setSaveState('saved')
      loggedCreate.current = false
      return
    }
    setIsWiki(!!doc.isWiki)
  }, [documentId, doc, user?.id])

  // Flush pending edits for the doc we're leaving so debounced saves cannot
  // write the previous page's HTML/page settings into the linked document.
  useEffect(() => {
    const leavingId = documentId
    return () => {
      const hadContentTimer = timer.current != null
      const hadSettingsTimer = settingsTimer.current != null
      const dirty =
        hadContentTimer ||
        hadSettingsTimer ||
        saveStateRef.current === 'unsaved' ||
        saveStateRef.current === 'saving'

      if (timer.current) {
        clearTimeout(timer.current)
        timer.current = null
      }
      if (settingsTimer.current) {
        clearTimeout(settingsTimer.current)
        settingsTimer.current = null
      }
      if (broadcastTimer.current) {
        window.clearTimeout(broadcastTimer.current)
        broadcastTimer.current = null
      }
      if (remoteApplyTimer.current) {
        window.clearTimeout(remoteApplyTimer.current)
        remoteApplyTimer.current = null
      }
      pendingRemote.current = null

      if (!leavingId || readOnlyRef.current || !dirty) return
      if (hydratedDocId.current !== leavingId) return

      const title = titleRef.current.trim() || 'Untitled'
      const content = contentRef.current
      const settings = pageSettingsRef.current
      void updateDocumentRef
        .current(leavingId, {
          title,
          content,
          ...(hadSettingsTimer ? { pageSettings: settings } : {}),
        })
        .catch(() => {})
    }
  }, [documentId])

  // Join the live document room immediately (+ on WS reconnect / presence.state).
  useEffect(() => {
    if (!documentId || !user?.id) return
    const join = () =>
      subscribeDocRoom(documentId, {
        username: displayName(user) || 'Teammate',
        color: colorForUser(user.id),
      })
    join()
    const iv = window.setInterval(join, 3_000)
    const off = realtime.on('presence.state', join)
    return () => {
      window.clearInterval(iv)
      off()
    }
  }, [documentId, user])

  useEffect(() => {
    if (routeTab) {
      setSidebarTab(routeTab)
      setShowSidebar(true)
    }
    setShowShare(location.pathname.endsWith('/share'))
  }, [location.pathname, routeTab])

  useEffect(() => {
    if (!documentId) return
    void openDocumentApi(documentId).catch(() => {})
  }, [documentId])

  useEffect(() => {
    if (doc && events.length === 0 && !loggedCreate.current) {
      loggedCreate.current = true
    }
  }, [doc, events.length])

  const persistContent = useCallback(
    (opts?: { createVersion?: boolean; immediate?: boolean }) => {
      if (readOnly) return
      const targetId = documentId
      setSaveState('unsaved')
      const run = () => {
        // Navigated away — leave-cleanup already flushed this doc.
        if (hydratedDocId.current !== targetId) return
        setSaveState('saving')
        const nextTitle = titleRef.current.trim() || 'Untitled'
        const nextContent = contentRef.current
        void updateDocument(targetId, {
          title: nextTitle,
          content: nextContent,
          createVersion: opts?.createVersion ?? false,
          versionSummary: opts?.createVersion ? 'Auto-saved' : undefined,
        }).finally(() => {
          if (hydratedDocId.current !== targetId) return
          setSaveState('saved')
        })
      }
      if (timer.current) clearTimeout(timer.current)
      if (opts?.immediate) {
        run()
        return
      }
      timer.current = setTimeout(run, SAVE_DEBOUNCE_MS)
    },
    [documentId, updateDocument, readOnly],
  )

  const scheduleSave = useCallback(() => {
    persistContent()
  }, [persistContent])

  const doBroadcastContent = useCallback(() => {
    if (readOnly || !documentId) return
    if (hydratedDocId.current !== documentId) return
    const stamp = contentStampRef.current
    publishDocContent(documentId, contentRef.current, stamp.version, {
      username: displayName(user) || 'Teammate',
      color: user ? colorForUser(user.id) : '#4f8bff',
    })
  }, [documentId, readOnly, user])

  const scheduleBroadcast = useCallback(() => {
    if (readOnly || !documentId) return
    const now = Date.now()
    const elapsed = now - lastBroadcast.current
    if (elapsed >= CONTENT_BROADCAST_MS) {
      lastBroadcast.current = now
      doBroadcastContent()
    } else if (!broadcastTimer.current) {
      broadcastTimer.current = window.setTimeout(() => {
        broadcastTimer.current = null
        lastBroadcast.current = Date.now()
        doBroadcastContent()
      }, CONTENT_BROADCAST_MS - elapsed)
    }
  }, [doBroadcastContent, documentId, readOnly])

  const flushPendingRemote = useCallback(() => {
    const pending = pendingRemote.current
    if (!pending) return
    if (!shouldApplyRemoteContent(contentStampRef.current, pending.version, pending.userId)) {
      pendingRemote.current = null
      return
    }
    // Still typing hard — wait a bit more so we don't yank the caret mid-keystroke.
    const sinceLocal = Date.now() - lastLocalEditAt.current
    if (sinceLocal < LOCAL_EDIT_HOLD_MS) {
      if (remoteApplyTimer.current) window.clearTimeout(remoteApplyTimer.current)
      remoteApplyTimer.current = window.setTimeout(flushPendingRemote, LOCAL_EDIT_HOLD_MS - sinceLocal)
      return
    }
    pendingRemote.current = null
    contentStampRef.current = { version: pending.version, userId: pending.userId }
    contentRef.current = pending.html
    editorRef.current?.applyRemoteContent(pending.html)
  }, [])

  useRealtime(
    'doc.content',
    (event) => {
      if (event.document_id !== documentId) return
      const remoteUserId = String(event.payload.user_id || '')
      if (!remoteUserId || remoteUserId === user?.id) return
      const remoteVersion = Number(event.payload.version ?? 0)
      if (!shouldApplyRemoteContent(contentStampRef.current, remoteVersion, remoteUserId)) return
      if (typeof event.payload.content !== 'string') return
      pendingRemote.current = {
        html: event.payload.content,
        version: remoteVersion,
        userId: remoteUserId,
      }
      // Idle peer → apply on next frame for snappy feel; active typer → short hold.
      const sinceLocal = Date.now() - lastLocalEditAt.current
      if (sinceLocal >= LOCAL_EDIT_HOLD_MS) {
        if (remoteApplyTimer.current) window.clearTimeout(remoteApplyTimer.current)
        remoteApplyTimer.current = window.setTimeout(flushPendingRemote, 0)
      } else {
        if (remoteApplyTimer.current) window.clearTimeout(remoteApplyTimer.current)
        remoteApplyTimer.current = window.setTimeout(flushPendingRemote, LOCAL_EDIT_HOLD_MS - sinceLocal)
      }
    },
    [documentId, user?.id, flushPendingRemote],
  )

  const persistMeta = useCallback(
    (patch: { coverUrl?: string | null; pageSettings?: DocPageSettings; icon?: string | null }) => {
      if (readOnly) return
      const targetId = documentId
      if (hydratedDocId.current !== targetId) return
      void updateDocument(targetId, patch).catch(() => toast.error('Could not save changes'))
    },
    [documentId, readOnly, updateDocument],
  )

  const onIconChange = useCallback(
    (icon: string | null) => {
      setDocIcon(icon)
      if (readOnly) return
      void updateDocument(documentId, { icon })
        .then((updated) => setDocIcon(updated.icon ?? null))
        .catch(() => {
          toast.error('Could not save icon')
          setDocIcon(doc?.icon ?? null)
        })
    },
    [readOnly, documentId, updateDocument, doc?.icon],
  )

  const onCoverChange = (url: string | null) => {
    setCoverUrl(url)
    if (url) {
      const nextSettings = { ...pageSettings, showCover: true }
      setPageSettings(nextSettings)
      persistMeta({ coverUrl: url, pageSettings: nextSettings })
    } else {
      persistMeta({ coverUrl: url })
    }
  }

  const onPageSettingsChange = (patch: Partial<DocPageSettings>) => {
    const targetId = documentId
    const next = { ...pageSettings, ...patch }
    setPageSettings(next)
    if (settingsTimer.current) clearTimeout(settingsTimer.current)
    settingsTimer.current = setTimeout(() => {
      if (hydratedDocId.current !== targetId) return
      persistMeta({ pageSettings: next })
    }, 400)
  }

  const onTitleChange = (value: string) => {
    setTitle(value)
    titleRef.current = value
    scheduleSave()
  }

  const onContentChange = useCallback(
    (html: string) => {
      contentRef.current = html
      lastLocalEditAt.current = Date.now()
      contentStampRef.current = {
        version: nextContentStamp(contentStampRef.current.version),
        userId: user?.id ?? '',
      }
      scheduleBroadcast()
      scheduleSave()
    },
    [scheduleBroadcast, scheduleSave, user?.id],
  )

  const onPeopleMentioned = useCallback(
    (userId: string, html?: string) => {
      const previewHtml = html ?? contentRef.current
      if (html) contentRef.current = html
      scheduleBroadcast()
      // Notify first so save-path mention fan-out does not race / skip the chip.
      void notifyDocumentBodyMentionApi(documentId, userId, previewHtml)
        .then((res) => {
          const detail =
            typeof res === 'object' && res && 'detail' in res ? String((res as { detail: string }).detail) : ''
          if (userId === 'all') {
            if (detail.toLowerCase().includes('no ')) {
              toast.error(detail || 'No one else to notify with @All')
            } else if (detail.toLowerCase().includes('sent')) {
              toast.success(detail)
            }
          }
        })
        .catch(() => {
          toast.error('Could not send mention notification')
        })
        .finally(() => {
          persistContent({ immediate: true })
        })
    },
    [documentId, persistContent, scheduleBroadcast],
  )

  const onCaretChange = useCallback(
    (offset: number) => {
      if (readOnly || !documentId) return
      const now = Date.now()
      if (now - lastCursorBroadcast.current < CURSOR_BROADCAST_MS) return
      lastCursorBroadcast.current = now
      publishDocCursor(documentId, offset, {
        username: displayName(user) || 'Teammate',
        color: user ? colorForUser(user.id) : '#4f8bff',
      })
    },
    [documentId, readOnly, user],
  )

  const openSidebar = (tab: RightSidebarTab) => {
    setSidebarTab(tab)
    setShowSidebar(true)
    if (tab !== 'details') navigate(`/app/docs/${documentId}/${tab}`, { replace: true })
  }

  const onToggleWiki = useCallback(() => {
    if (readOnly) return
    const next = !isWiki
    setIsWiki(next)
    void updateDocument(documentId, { isWiki: next })
      .then(() => toast.success(next ? 'Marked as wiki' : 'Removed wiki mark'))
      .catch(() => {
        setIsWiki(!next)
        toast.error('Could not update wiki status')
      })
  }, [readOnly, isWiki, documentId, updateDocument])

  const onOpenSettings = useCallback((tab: 'doc' | 'page' = 'page') => {
    setSettingsTab(tab)
    setShowSettings(true)
  }, [])

  const onRenameFromSettings = useCallback(() => {
    setShowSettings(false)
    requestAnimationFrame(() => titleInputRef.current?.focus())
  }, [])

  const onOpenHistory = useCallback(() => {
    openSidebar('history')
  }, [documentId, navigate])

  const onOpenShare = useCallback((scope: ShareScope = 'doc') => {
    setShareScope(scope)
    setShowShare(true)
  }, [])

  const onInlineComment = useCallback((quote: string, markerId: string) => {
    setPendingInline({ quote, markerId })
    setSidebarTab('comments')
    setShowSidebar(true)
  }, [])

  const onMarkerClick = useCallback((markerId: string) => {
    setSidebarTab('comments')
    setShowSidebar(true)
    setPendingInline({ markerId, quote: '' })
  }, [])

  const focusEditor = useCallback(() => {
    editorRef.current?.focus()
  }, [])

  const startMention = useCallback(() => {
    editorRef.current?.focus()
    editorRef.current?.insertAt()
  }, [])

  const createSubpage = useCallback(
    async (titleFromSelection?: string) => {
      if (readOnly) return
      try {
        const child = await createDocument({
          title: (titleFromSelection || 'Untitled').slice(0, 200),
          folderId: doc?.folderId ?? null,
        })
        editorRef.current?.subpage(child.id, child.title)
        toast.success('Subpage created')
      } catch {
        toast.error('Could not create subpage')
      }
    },
    [readOnly, createDocument, doc?.folderId],
  )

  const handleInsertBlock = useCallback(
    async (type: DocInsertBlock) => {
      if (readOnly) return
      focusEditor()
      switch (type) {
        case 'table':
          editorRef.current?.table()
          break
        case 'column':
          editorRef.current?.columns()
          break
        case 'list':
          editorRef.current?.taskList()
          break
        case 'subpage':
          await createSubpage('Untitled')
          break
      }
    },
    [readOnly, focusEditor, createSubpage],
  )

  const handleApplyTypographyPage = useCallback(async () => {
    if (readOnly) return
    try {
      await updateDocument(documentId, {
        pageSettings: {
          ...DEFAULT_PAGE_SETTINGS,
          ...pageSettings,
          fontStyle: pageSettings.fontStyle,
          fontSize: pageSettings.fontSize,
          pageWidth: pageSettings.pageWidth,
        },
      })
      toast.success('Typography applied to this page')
    } catch {
      toast.error('Could not apply typography')
    }
  }, [
    readOnly,
    documentId,
    updateDocument,
    pageSettings,
  ])

  const handleApplyTypographyAll = useCallback(async () => {
    if (readOnly) return
    const targets = activeDocuments.filter((d) => !d.archivedAt && !d.deletedAt)
    try {
      await Promise.all(
        targets.map((d) =>
          updateDocument(d.id, {
            pageSettings: {
              ...DEFAULT_PAGE_SETTINGS,
              ...d.pageSettings,
              fontStyle: pageSettings.fontStyle,
              fontSize: pageSettings.fontSize,
              pageWidth: pageSettings.pageWidth,
            },
          }),
        ),
      )
      toast.success(`Typography applied to ${targets.length} page${targets.length === 1 ? '' : 's'}`)
    } catch {
      toast.error('Could not apply typography')
    }
  }, [readOnly, activeDocuments, updateDocument, pageSettings.fontStyle, pageSettings.fontSize, pageSettings.pageWidth])

  const docStats = useMemo(
    () => computeDocStats(contentRef.current || doc?.content || ''),
    // Recompute when content saves or doc loads
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [doc?.content, saveState, title],
  )

  const handleExported = () => {
    toast.success('Document exported')
  }

  if (docLoading) {
    return (
      <div className="flex h-full items-center justify-center text-fg-muted">
        <Loader2 size={22} className="animate-spin" />
      </div>
    )
  }

  if (!doc) {
    return (
      <div className="flex h-full items-center justify-center">
        <EmptyState
          icon={FileQuestion}
          title="Document not found"
          description="It may have been deleted or moved."
          action={
            <Link to="/app/docs" className="btn-primary">
              Back to Docs
            </Link>
          }
        />
      </div>
    )
  }

  const crumbs: Crumb[] = [
    { label: workspaceName, to: '/app/docs' },
    ...folderPath(doc.folderId).map((f) => ({ label: f.name, to: `/app/docs/folder/${f.id}` })),
    { label: title || 'Untitled' },
  ]

  const showCover = pageSettings.showCover !== false
  const typography = pageSettingsTypography(pageSettings)
  const widthClass = pageSettingsWidth(pageSettings)
  const focusModeClass = pageFocusClasses(pageSettings)

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between gap-3 border-b border-ink-700 px-6 py-2.5">
        <DocsBreadcrumb items={crumbs} />
        <div className="flex shrink-0 items-center gap-2">
          <PresenceStack viewers={viewers} />
          <PermissionBadge role={role} />
          {canShare && (
            <button
              type="button"
              onClick={() => onOpenShare('doc')}
              className="flex h-7 items-center gap-1.5 rounded-lg border border-ink-700 bg-ink-800 px-2.5 text-xs font-medium text-fg-secondary hover:text-fg"
            >
              <Share2 size={14} /> Share
            </button>
          )}
          <Dropdown
            align="right"
            width="w-48"
            trigger={
              <button
                type="button"
                aria-label="More options"
                className="flex h-7 w-7 items-center justify-center rounded-lg border border-ink-700 bg-ink-800 text-fg-secondary hover:text-fg"
              >
                <MoreHorizontal size={16} />
              </button>
            }
          >
            {(close) => (
              <>
                <button type="button" className="menu-item" onClick={() => { close(); onOpenSettings('doc') }}>
                  <Settings size={14} /> Settings
                </button>
                <button type="button" className="menu-item" onClick={() => { close(); openSidebar('styles') }}>
                  Page styles
                </button>
              </>
            )}
          </Dropdown>
          {archived ? (
            <span className="flex items-center gap-1.5 rounded-lg bg-ink-800 px-2.5 py-1 text-xs font-medium text-fg-muted">
              <Lock size={12} /> Read-only
            </span>
          ) : lockedByProtection ? (
            <span className="flex items-center gap-1.5 rounded-lg bg-amber-500/10 px-2.5 py-1 text-xs font-medium text-amber-300">
              <Lock size={12} /> Protected
            </span>
          ) : null}
        </div>
      </div>

      {archived && (
        <div className="flex items-center justify-between gap-3 border-b border-amber-500/20 bg-amber-500/10 px-6 py-2 text-sm text-amber-300">
          <span>This document is archived and read-only.</span>
          <button
            type="button"
            onClick={() => unarchive([documentId])}
            className="flex items-center gap-1.5 rounded-lg bg-amber-500/20 px-2.5 py-1 text-xs font-semibold text-amber-200 transition-colors hover:bg-amber-500/30"
          >
            <ArchiveRestore size={13} /> Unarchive
          </button>
        </div>
      )}

      <div className="flex min-h-0 flex-1">
        <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
          <DocCoverBanner
            coverUrl={coverUrl}
            showCover={showCover}
            onCoverChange={onCoverChange}
            readOnly={readOnly}
          />

          <div className={cn('group/pagehead px-6 pt-4', typography, widthClass, 'mx-auto w-full', focusModeClass)}>
            <DocPageToolbar
              documentId={documentId}
              readOnly={readOnly}
              isWiki={isWiki}
              onToggleWiki={onToggleWiki}
              docIcon={docIcon}
              onIconChange={onIconChange}
              coverUrl={coverUrl}
              onCoverChange={onCoverChange}
              onOpenSettings={() => onOpenSettings('page')}
            />

            <DocLinkedChips documentId={documentId} readOnly={readOnly} />

            {docIcon && pageSettings.showPageIcon && (
              <div className="mt-4 text-4xl leading-none">{docIcon}</div>
            )}

            <input
              ref={titleInputRef}
              value={title}
              onChange={(e) => onTitleChange(e.target.value)}
              placeholder="Untitled"
              aria-label="Document title"
              readOnly={readOnly}
              className={cn(
                'w-full border-0 bg-transparent text-3xl font-bold text-fg outline-none placeholder:text-fg-muted',
                docIcon && pageSettings.showPageIcon ? 'mt-2' : 'mt-4',
              )}
            />

            {pageSettings.showSubtitle && pageSettings.subtitle && (
              <p className="mt-1 text-lg text-fg-muted">{pageSettings.subtitle}</p>
            )}

            {(pageSettings.showOwners || pageSettings.showContributors || pageSettings.showLastModified) && (
              <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-fg-muted">
                {pageSettings.showOwners && (
                  <>
                    <Avatar name={doc.author} size={22} userId={doc.authorId} />
                    <span>{doc.author}</span>
                  </>
                )}
                {pageSettings.showContributors && (doc.shareMemberCount ?? 0) > 0 && (
                  <>
                    {pageSettings.showOwners && <span>·</span>}
                    <span>{doc.shareMemberCount} contributor{(doc.shareMemberCount ?? 0) === 1 ? '' : 's'}</span>
                  </>
                )}
                {pageSettings.showLastModified && (
                  <>
                    {(pageSettings.showOwners || pageSettings.showContributors) && <span>·</span>}
                    <span>Last updated {timeAgo(doc.updatedAt)}</span>
                  </>
                )}
              </div>
            )}

            {pageSettings.showStatsOnPage && (
              <p className="mt-2 text-xs text-fg-muted">
                {docStats.words} words · {docStats.chars} characters · {formatReadingTime(docStats.readingTimeSec)}
              </p>
            )}
          </div>

          {!readOnly && editorApi && toolbarPosition === 'top' && (
            <div className="sticky top-0 z-20 border-b border-ink-700 bg-ink-900/95 backdrop-blur">
              <div className={cn('mx-auto w-full', widthClass)}>
                <DocToolbar api={editorApi} />
              </div>
            </div>
          )}

          <Suspense
            fallback={
              <div className="flex flex-1 items-center justify-center text-fg-muted">
                <Loader2 size={18} className="animate-spin" />
              </div>
            }
          >
            {editorSeed?.docId === documentId ? (
              <DocEditor
                key={`${documentId}-${editorReloadKey}`}
                ref={editorRef}
                docId={documentId}
                initialContent={editorSeed.content}
                onChange={onContentChange}
                readOnly={readOnly}
                canComment={canComment && !archived}
                onInlineComment={onInlineComment}
                onMarkerClick={onMarkerClick}
                onPeopleMentioned={onPeopleMentioned}
                onCaretChange={onCaretChange}
                contentClassName={cn(typography, widthClass)}
                focusClassName={focusModeClass}
                showToolbar={false}
                toolbarPosition={toolbarPosition}
                onToolbarPositionChange={onToolbarPositionChange}
                onCreateSubpage={createSubpage}
                onQuickStartMention={startMention}
                onApiReady={setEditorApi}
              />
            ) : (
              <div className="flex flex-1 items-center justify-center text-fg-muted">
                <Loader2 size={18} className="animate-spin" />
              </div>
            )}
          </Suspense>
        </div>

        {showSidebar && (
          <RightSidebar
            doc={doc}
            tab={sidebarTab}
            onTabChange={setSidebarTab}
            onClose={() => {
              setShowSidebar(false)
              navigate(`/app/docs/${documentId}`, { replace: true })
            }}
            canComment={canComment && !archived}
            commentCount={commentCount}
            pendingInline={pendingInline}
            onClearInline={() => setPendingInline(null)}
            pageSettings={pageSettings}
            onPageSettingsChange={onPageSettingsChange}
            readOnly={readOnly}
            docIcon={docIcon}
            onIconChange={onIconChange}
            onInsertBlock={handleInsertBlock}
            onApplyTypographyPage={handleApplyTypographyPage}
            onApplyTypographyAll={handleApplyTypographyAll}
            stats={docStats}
            onOpenLinks={() => openSidebar('links')}
          />
        )}

        <DocPageRail
          activeTab={showSidebar ? sidebarTab : null}
          showSidebar={showSidebar}
          commentCount={commentCount}
          canShare={canShare}
          exportDoc={{
            id: doc.id,
            title: title || doc.title,
            content: contentRef.current || doc.content,
          }}
          onExported={handleExported}
          onTab={openSidebar}
          onShare={() => onOpenShare('doc')}
        />
      </div>

      <ShareDocumentModal
        doc={doc}
        open={showShare}
        scope={shareScope}
        onScopeChange={setShareScope}
        onClose={() => {
          setShowShare(false)
          setShareScope('doc')
          if (location.pathname.endsWith('/share')) navigate(`/app/docs/${documentId}`, { replace: true })
        }}
      />

      <DocSettingsModal
        doc={doc}
        open={showSettings}
        defaultTab={settingsTab}
        readOnly={readOnly}
        canManage={canShare}
        onClose={() => setShowSettings(false)}
        onOpenShare={() => onOpenShare(shareScope)}
        onOpenHistory={onOpenHistory}
        onRename={onRenameFromSettings}
        onImported={(content, importedTitle) => {
          const nextTitle = (importedTitle || '').trim()
          contentRef.current = content
          setEditorSeed({ docId: documentId, content })
          if (nextTitle) {
            setTitle(nextTitle)
            titleRef.current = nextTitle
          }
          setEditorReloadKey((k) => k + 1)
          void updateDocument(documentId, {
            content,
            ...(nextTitle ? { title: nextTitle } : {}),
          }).catch(() => toast.error('Could not save imported content'))
        }}
      />
    </div>
  )
}

