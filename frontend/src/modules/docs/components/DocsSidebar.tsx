import { useMemo, useRef, useState } from 'react'
import {
  Archive,
  BadgeCheck,
  BookOpen,
  ChevronDown,
  FileText,
  FolderPlus,
  LayoutTemplate,
  Lock,
  Plus,
  Sparkles,
  Trash2,
  Upload,
  Users,
  type LucideIcon,
} from 'lucide-react'
import { useQuery } from '@tanstack/react-query'
import { useLocation, useNavigate } from 'react-router-dom'

import { useCurrentContext } from '../../../lib/queries'
import { displayName, useAuthStore } from '../../../stores/auth'
import { toast } from '../../../stores/toast'
import { Avatar } from '../../../components/ui/Avatar'
import { SecondarySidebar } from '../../../components/layout/SecondarySidebar'
import { SidebarCollapseButton } from '../../../components/layout/SidebarCollapseButton'
import { RenameModal } from '../../../components/ui/RenameModal'
import { cn } from '../../../lib/utils'
import { useDocs } from '../context/DocsContext'
import { useArchive } from '../hooks/useArchive'
import { useDocuments } from '../hooks/useDocuments'
import { useFavorites } from '../hooks/useFavorites'
import { useFolders } from '../hooks/useFolders'
import { useTrash } from '../hooks/useTrash'
import { docsKeys, fetchDocuments, fetchRecent } from '../services/docsApi.service'
import { importFileToWorkspace } from '../services/docImport.service'
import { isActive } from '../services/docs.service'
import type { FlowDoc } from '../types/document'

const RECENT_PREVIEW = 5
const FAVORITES_PREVIEW = 6
const WIKIS_PREVIEW = 5

function activeFolderFromPath(pathname: string): string | null {
  const m = pathname.match(/^\/app\/docs\/folder\/([^/]+)/)
  return m ? m[1] : null
}

/** ClickUp-style Docs sidebar: scoped views + favorites, recents, and wikis. */
export function DocsSidebar() {
  const navigate = useNavigate()
  const location = useLocation()
  const { workspace } = useCurrentContext()
  const wsId = workspace?.id
  const user = useAuthStore((s) => s.user)
  const { setSearch, createDocument } = useDocs()
  const { activeDocuments } = useDocuments()
  const { addFolder } = useFolders()
  const { entries: favoriteEntries, favoritedAt } = useFavorites()
  const { archived } = useArchive()
  const { trashed } = useTrash()

  const [createOpen, setCreateOpen] = useState(false)
  const [creatingFolder, setCreatingFolder] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const path = location.pathname
  const activeFolderId = activeFolderFromPath(path)
  const isAllDocs = (path === '/app/docs' || !!activeFolderId) && path !== '/app/docs/new'

  const mineQuery = useQuery({
    queryKey: docsKeys.documents(wsId ?? '', 'scope:mine-count'),
    queryFn: () => fetchDocuments(wsId!, { deleted: false, archived: false, scope: 'mine' }),
    enabled: !!wsId,
  })

  const wikisQuery = useQuery({
    queryKey: docsKeys.documents(wsId ?? '', 'scope:wikis-sidebar'),
    queryFn: () => fetchDocuments(wsId!, { deleted: false, archived: false, isWiki: true }),
    enabled: !!wsId,
  })

  const recentQuery = useQuery({
    queryKey: docsKeys.recent(),
    queryFn: fetchRecent,
  })

  const myDocsCount = mineQuery.data?.length ?? 0

  const favoriteDocs = useMemo(() => {
    const docIds = new Set(favoriteEntries.filter((e) => e.type === 'doc').map((e) => e.id))
    return activeDocuments
      .filter((d) => docIds.has(d.id))
      .sort((a, b) => favoritedAt(b.id) - favoritedAt(a.id))
      .slice(0, FAVORITES_PREVIEW)
  }, [activeDocuments, favoriteEntries, favoritedAt])

  const recentDocs = useMemo(() => {
    const byId = new Map(activeDocuments.map((d) => [d.id, d]))
    const out: FlowDoc[] = []
    for (const row of recentQuery.data ?? []) {
      const doc = row.doc ?? byId.get(row.documentId)
      if (doc && isActive(doc)) out.push(doc)
      if (out.length >= RECENT_PREVIEW) break
    }
    return out
  }, [activeDocuments, recentQuery.data])

  const popularWikis = useMemo(() => {
    return [...(wikisQuery.data ?? [])]
      .sort((a, b) => (b.viewCount ?? 0) - (a.viewCount ?? 0))
      .slice(0, WIKIS_PREVIEW)
  }, [wikisQuery.data])

  const goto = (to: string) => {
    setSearch('')
    navigate(to)
  }

  const createDoc = (isWiki = false) => {
    setCreateOpen(false)
    void createDocument({ folderId: activeFolderId, isWiki }).then((doc) => navigate(`/app/docs/${doc.id}`))
  }

  const onImportFile = async (file: File | undefined) => {
    if (!file) return
    if (!wsId) {
      toast.error('Select a workspace before importing')
      return
    }
    setCreateOpen(false)
    try {
      const doc = await importFileToWorkspace(wsId, file, activeFolderId)
      toast.success('Document imported')
      navigate(`/app/docs/${doc.id}`)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not import that file')
    }
  }

  return (
    <SecondarySidebar className="overflow-hidden bg-ink-900/40">
      <div className="flex items-center justify-between gap-2 px-4 pb-3 pt-4">
        <h2 className="min-w-0 flex-1 truncate text-[15px] font-bold text-fg">Docs</h2>
        <div className="flex shrink-0 items-center gap-1.5">
          <div className="relative">
            <div className="flex overflow-hidden rounded-lg border border-ink-600 bg-ink-850">
              <button
                type="button"
                aria-label="New document"
                onClick={() => createDoc(false)}
                className="flex h-7 w-7 items-center justify-center text-fg-secondary transition-colors hover:bg-ink-750 hover:text-fg"
              >
                <Plus size={15} strokeWidth={2.25} />
              </button>
              <button
                type="button"
                aria-label="More create options"
                aria-haspopup="menu"
                aria-expanded={createOpen}
                onClick={() => setCreateOpen((o) => !o)}
                className="flex h-7 w-5 items-center justify-center border-l border-ink-600 text-fg-secondary transition-colors hover:bg-ink-750 hover:text-fg"
              >
                <ChevronDown size={13} />
              </button>
            </div>
            {createOpen && (
              <>
                <div className="fixed inset-0 z-40" onClick={() => setCreateOpen(false)} aria-hidden />
                <div
                  role="menu"
                  className="absolute right-0 top-9 z-50 w-48 overflow-hidden rounded-xl border border-ink-700 bg-ink-850 py-1 shadow-xl"
                >
                  <CreateMenuItem icon={FileText} label="Create Doc" onClick={() => createDoc(false)} />
                  <CreateMenuItem icon={BookOpen} label="Create Wiki" onClick={() => createDoc(true)} />
                  <CreateMenuItem
                    icon={FolderPlus}
                    label="Create Folder"
                    onClick={() => {
                      setCreateOpen(false)
                      setCreatingFolder(true)
                    }}
                  />
                  <CreateMenuItem icon={LayoutTemplate} label="Apply a template" onClick={() => goto('/app/docs/templates')} />
                  <CreateMenuItem icon={Upload} label="Import" onClick={() => fileInputRef.current?.click()} />
                </div>
              </>
            )}
            <input
              ref={fileInputRef}
              type="file"
              accept=".md,.markdown,.txt,.text,.html,.htm,text/plain,text/markdown,text/html"
              className="hidden"
              onChange={(e) => {
                void onImportFile(e.target.files?.[0])
                e.target.value = ''
              }}
            />
          </div>
          <SidebarCollapseButton />
        </div>
      </div>

      <RenameModal
        open={creatingFolder}
        onClose={() => setCreatingFolder(false)}
        title={activeFolderId ? 'New subfolder' : 'New folder'}
        label="Folder name"
        initialName=""
        onSave={async (name) => {
          try {
            const folder = await addFolder(name, activeFolderId)
            setCreatingFolder(false)
            navigate(`/app/docs/folder/${folder.id}`)
            toast.success('Folder created')
          } catch {
            toast.error('Could not create folder')
          }
        }}
      />

      <nav className="min-h-0 flex-1 space-y-4 overflow-y-auto px-2 pb-4">
        <div className="space-y-0.5">
          <NavItem icon={FileText} label="All Docs" active={isAllDocs} onClick={() => goto('/app/docs')} />
          <NavItem
            label="My Docs"
            active={path === '/app/docs/mine'}
            count={myDocsCount || undefined}
            onClick={() => goto('/app/docs/mine')}
            leading={
              <Avatar
                name={displayName(user) || 'Me'}
                src={user?.profile?.avatar_url}
                size={18}
                className="ring-1 ring-ink-600"
              />
            }
          />
          <NavItem icon={Users} label="Shared with me" active={path === '/app/docs/shared'} onClick={() => goto('/app/docs/shared')} />
          <NavItem icon={Lock} label="Private" active={path === '/app/docs/private'} onClick={() => goto('/app/docs/private')} />
          <NavItem
            icon={Sparkles}
            label="Meeting Notes"
            active={path === '/app/docs/meeting-notes'}
            onClick={() => goto('/app/docs/meeting-notes')}
          />
          <NavItem
            icon={Archive}
            label="Archived"
            active={path === '/app/docs/archived'}
            count={archived.length || undefined}
            onClick={() => goto('/app/docs/archived')}
          />
        </div>

        {favoriteDocs.length > 0 && (
          <SidebarSection title="Favorites">
            {favoriteDocs.map((doc) => (
              <DocSidebarLink key={doc.id} doc={doc} active={path === `/app/docs/${doc.id}`} onClick={() => goto(`/app/docs/${doc.id}`)} />
            ))}
            {favoriteEntries.filter((e) => e.type === 'doc').length > FAVORITES_PREVIEW && (
              <MoreLink label="More" onClick={() => goto('/app/docs/favorites')} />
            )}
          </SidebarSection>
        )}

        {recentDocs.length > 0 && (
          <SidebarSection title="Recent Pages">
            {recentDocs.map((doc) => (
              <DocSidebarLink key={doc.id} doc={doc} active={path === `/app/docs/${doc.id}`} onClick={() => goto(`/app/docs/${doc.id}`)} />
            ))}
            {(recentQuery.data?.length ?? 0) > RECENT_PREVIEW && (
              <MoreLink label="More" onClick={() => goto('/app/docs/recent')} />
            )}
          </SidebarSection>
        )}

        {popularWikis.length > 0 && (
          <SidebarSection title="Popular Wikis">
            {popularWikis.map((doc) => (
              <DocSidebarLink
                key={doc.id}
                doc={doc}
                active={path === `/app/docs/${doc.id}`}
                verified
                onClick={() => goto(`/app/docs/${doc.id}`)}
              />
            ))}
            {(wikisQuery.data?.length ?? 0) > WIKIS_PREVIEW && (
              <MoreLink label="More" onClick={() => goto('/app/docs/wikis')} />
            )}
          </SidebarSection>
        )}
      </nav>

      <div className="border-t border-ink-700 px-2 py-2">
        <NavItem
          icon={Trash2}
          label="Trash"
          active={path === '/app/docs/trash'}
          count={trashed.length || undefined}
          onClick={() => goto('/app/docs/trash')}
          compact
        />
      </div>
    </SecondarySidebar>
  )
}

function SidebarSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="mb-1 px-2 text-[11px] font-semibold uppercase tracking-wider text-fg-muted">{title}</p>
      <div className="space-y-0.5">{children}</div>
    </div>
  )
}

function DocSidebarLink({
  doc,
  active,
  verified,
  onClick,
}: {
  doc: FlowDoc
  active?: boolean
  verified?: boolean
  onClick: () => void
}) {
  const LeadIcon = doc.isWiki ? BookOpen : FileText

  return (
    <button
      type="button"
      onClick={onClick}
      title={doc.title}
      className={cn(
        'flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-[13px] transition-colors',
        active ? 'bg-ink-750 text-fg' : 'text-fg-secondary hover:bg-ink-800/80 hover:text-fg',
      )}
    >
      {doc.icon ? (
        <span className="flex h-[18px] w-[18px] shrink-0 items-center justify-center text-sm leading-none">{doc.icon}</span>
      ) : (
        <LeadIcon size={15} className="shrink-0 text-brand" />
      )}
      <span className="min-w-0 flex-1 truncate">{doc.title || 'Untitled'}</span>
      {verified && <BadgeCheck size={14} className="shrink-0 text-fg-muted" aria-label="Wiki" />}
    </button>
  )
}

function MoreLink({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="mt-0.5 w-full rounded-lg px-2 py-1 text-left text-xs text-fg-muted transition-colors hover:bg-ink-800/60 hover:text-fg-secondary"
    >
      … {label}
    </button>
  )
}

function CreateMenuItem({ icon: Icon, label, onClick }: { icon: LucideIcon; label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      role="menuitem"
      onClick={onClick}
      className="flex w-full items-center gap-2.5 px-3 py-2 text-left text-sm text-fg-secondary transition-colors hover:bg-ink-750 hover:text-fg"
    >
      <Icon size={15} className="shrink-0" />
      <span className="flex-1">{label}</span>
    </button>
  )
}

function NavItem({
  icon: Icon,
  label,
  active,
  count,
  leading,
  onClick,
  compact,
}: {
  icon?: LucideIcon
  label: string
  active: boolean
  count?: number
  leading?: React.ReactNode
  onClick: () => void
  compact?: boolean
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'flex w-full items-center gap-2.5 rounded-lg text-sm transition-colors',
        compact ? 'px-2 py-1.5' : 'px-2.5 py-1.5',
        active ? 'bg-ink-750 font-medium text-fg' : 'text-fg-secondary hover:bg-ink-800/80 hover:text-fg',
      )}
    >
      {leading ?? (Icon ? <Icon size={15} className="shrink-0 opacity-90" /> : null)}
      <span className="flex-1 truncate text-left">{label}</span>
      {count != null && count > 0 && (
        <span className="shrink-0 text-xs tabular-nums text-fg-muted">{count}</span>
      )}
    </button>
  )
}
