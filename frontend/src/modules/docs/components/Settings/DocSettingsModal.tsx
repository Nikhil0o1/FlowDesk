import { useEffect, useRef, useState } from 'react'
import {
  Archive,
  BookOpen,
  ChevronRight,
  Clock,
  Copy,
  Download,
  FileText,
  FolderInput,
  Globe,
  LayoutTemplate,
  Link2,
  Pencil,
  Share2,
  Shield,
  Star,
  Trash2,
  Upload,
  Wand2,
} from 'lucide-react'
import { useNavigate } from 'react-router-dom'

import { Modal } from '../../../../components/ui/Modal'
import { cn } from '../../../../lib/utils'
import { toast } from '../../../../stores/toast'
import { useArchive } from '../../hooks/useArchive'
import { useDocTemplates } from '../../hooks/useDocTemplates'
import { useDocuments } from '../../hooks/useDocuments'
import { useFavorites } from '../../hooks/useFavorites'
import { useFolders } from '../../hooks/useFolders'
import { useSharing } from '../../hooks/useSharing'
import {
  DOC_EXPORT_EXTRA_FORMATS,
  DOC_EXPORT_FORMATS,
  exportDocument,
  importFileAsDoc,
  type ExportFormat,
} from '../../services/docExport.service'
import { privateDocLink } from '../../services/sharing.service'
import type { FlowDoc } from '../../types/document'

type SettingsTab = 'doc' | 'page'

function Toggle({
  checked,
  onChange,
  disabled,
}: {
  checked: boolean
  onChange: (v: boolean) => void
  disabled?: boolean
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cn(
        'relative h-5 w-9 shrink-0 rounded-full transition-colors disabled:opacity-50',
        checked ? 'bg-brand' : 'bg-ink-700',
      )}
    >
      <span
        className={cn(
          'absolute top-0.5 h-4 w-4 rounded-full bg-white transition-all',
          checked ? 'left-[18px]' : 'left-0.5',
        )}
      />
    </button>
  )
}

function SettingsRow({
  icon: Icon,
  label,
  onClick,
  disabled,
  danger,
  trailing,
  chevron,
}: {
  icon: typeof Pencil
  label: string
  onClick?: () => void
  disabled?: boolean
  danger?: boolean
  trailing?: React.ReactNode
  chevron?: boolean
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={cn(
        'flex w-full items-center gap-3 rounded-lg px-2 py-2 text-left text-sm transition-colors disabled:cursor-not-allowed disabled:opacity-40',
        danger ? 'text-rose-400 hover:bg-rose-500/10' : 'text-fg hover:bg-ink-800',
      )}
    >
      <Icon size={15} className="shrink-0 text-fg-muted" />
      <span className="min-w-0 flex-1">{label}</span>
      {trailing}
      {chevron && <ChevronRight size={14} className="shrink-0 text-fg-muted" />}
    </button>
  )
}

function SettingsToggleRow({
  icon: Icon,
  label,
  checked,
  onChange,
  disabled,
}: {
  icon: typeof Shield
  label: string
  checked: boolean
  onChange: (v: boolean) => void
  disabled?: boolean
}) {
  return (
    <div className="flex items-center gap-3 rounded-lg px-2 py-2">
      <Icon size={15} className="shrink-0 text-fg-muted" />
      <span className="min-w-0 flex-1 text-sm text-fg">{label}</span>
      <Toggle checked={checked} onChange={onChange} disabled={disabled} />
    </div>
  )
}

/** ClickUp-style settings menu with Entire Doc / This page tabs. */
export function DocSettingsModal({
  doc,
  open,
  onClose,
  defaultTab = 'doc',
  readOnly,
  canManage,
  onOpenShare,
  onOpenHistory,
  onRename,
  onImported,
}: {
  doc: FlowDoc
  open: boolean
  onClose: () => void
  defaultTab?: SettingsTab
  readOnly?: boolean
  canManage?: boolean
  onOpenShare?: () => void
  onOpenHistory?: () => void
  onRename?: () => void
  onImported?: (content: string, title?: string) => void
}) {
  const navigate = useNavigate()
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [tab, setTab] = useState<SettingsTab>(defaultTab)
  const [expanded, setExpanded] = useState<'move' | 'import' | 'export' | null>(null)
  const [busy, setBusy] = useState(false)

  const { folders } = useFolders()
  const { duplicateDocument, moveDocument, deleteDocument, setProtected, updateDocument } = useDocuments()
  const { isFavorite, toggleFavorite } = useFavorites()
  const { archive } = useArchive()
  const { saveAsTemplate } = useDocTemplates()
  const { togglePublic, share } = useSharing(doc.id, doc.title, doc.author, doc.authorId)

  const favorite = isFavorite(doc.id)
  const archived = !!doc.archivedAt
  const manage = !!canManage && !readOnly

  useEffect(() => {
    if (!open) return
    setTab(defaultTab)
    setExpanded(null)
  }, [open, defaultTab, doc.id])

  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(privateDocLink(doc.id))
      toast.success('Link copied')
    } catch {
      toast.error('Could not copy link')
    }
  }

  const run = async (fn: () => Promise<void>) => {
    setBusy(true)
    try {
      await fn()
    } finally {
      setBusy(false)
    }
  }

  const onDuplicate = () =>
    void run(async () => {
      const copy = await duplicateDocument(doc.id)
      toast.success('Duplicated')
      onClose()
      navigate(`/app/docs/${copy.id}`)
    })

  const onDelete = () => {
    if (!window.confirm(`Delete "${doc.title || 'Untitled'}"? You can restore it from Trash.`)) return
    void run(async () => {
      await deleteDocument(doc.id)
      toast.success('Moved to trash')
      onClose()
      navigate('/app/docs')
    })
  }

  const onSaveAsTemplate = async () => {
    const name = window.prompt('Template name', doc.title || 'Untitled template')
    if (!name?.trim()) return
    try {
      await saveAsTemplate({ name: name.trim(), documentId: doc.id })
      toast.success('Saved as template')
    } catch {
      toast.error('Could not save template')
    }
  }

  const onExport = async (format: ExportFormat) => {
    try {
      await exportDocument(doc, format)
      toast.success(`Exported as ${format.toUpperCase()}`)
    } catch {
      toast.error('Export failed')
    }
  }

  const onImportFile = async (file: File | undefined) => {
    if (!file || !manage) return
    try {
      const imported = await importFileAsDoc(file)
      if (onImported) {
        onImported(imported.content, imported.title)
      } else {
        await updateDocument(doc.id, {
          content: imported.content,
          ...(imported.title ? { title: imported.title } : {}),
        })
      }
      toast.success('Imported')
      onClose()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Import failed')
    } finally {
      if (fileInputRef.current) fileInputRef.current.value = ''
    }
  }

  const moveFolders = folders.filter((f) => f.id !== doc.folderId)

  const docTab = (
    <>
      <SettingsRow icon={Pencil} label="Rename" onClick={onRename} disabled={!manage} />
      <SettingsRow icon={Link2} label="Copy link" onClick={() => void copyLink()} />
      <SettingsRow
        icon={Star}
        label="Favorite"
        trailing={<Toggle checked={favorite} onChange={() => toggleFavorite(doc.id, 'doc')} />}
      />
      <SettingsRow icon={Copy} label="Duplicate" onClick={onDuplicate} disabled={!manage || busy} />
      <SettingsRow
        icon={FolderInput}
        label="Move to"
        chevron
        disabled={!manage || moveFolders.length === 0 && !doc.folderId}
        onClick={() => setExpanded((v) => (v === 'move' ? null : 'move'))}
      />
      {expanded === 'move' && manage && (
        <div className="ml-7 space-y-0.5 border-l border-ink-700 pl-2">
          {doc.folderId && (
            <SettingsRow
              icon={FolderInput}
              label="Move to root"
              onClick={() => void run(async () => { await moveDocument(doc.id, null); toast.success('Moved'); onClose() })}
            />
          )}
          {moveFolders.map((f) => (
            <SettingsRow
              key={f.id}
              icon={FolderInput}
              label={f.name}
              onClick={() => void run(async () => { await moveDocument(doc.id, f.id); toast.success('Moved'); onClose() })}
            />
          ))}
        </div>
      )}
      <SettingsRow
        icon={Upload}
        label="Import"
        chevron
        disabled={!manage}
        onClick={() => setExpanded((v) => (v === 'import' ? null : 'import'))}
      />
      {expanded === 'import' && manage && (
        <div className="ml-7 border-l border-ink-700 pl-2">
          <SettingsRow icon={Upload} label="Import file (HTML, Markdown, text)" onClick={() => fileInputRef.current?.click()} />
        </div>
      )}
      <SettingsRow
        icon={Download}
        label="Export"
        chevron
        onClick={() => setExpanded((v) => (v === 'export' ? null : 'export'))}
      />
      {expanded === 'export' && (
        <div className="ml-7 space-y-0.5 border-l border-ink-700 pl-2">
          {[...DOC_EXPORT_FORMATS, ...DOC_EXPORT_EXTRA_FORMATS].map((item) => (
            <SettingsRow key={item.format} icon={Download} label={item.label} onClick={() => void onExport(item.format)} />
          ))}
        </div>
      )}

      <div className="my-2 border-t border-ink-700" />

      <SettingsRow icon={Wand2} label="Apply a template" onClick={() => { onClose(); navigate('/app/docs/templates') }} />
      <SettingsRow icon={LayoutTemplate} label="Save as template" onClick={() => void onSaveAsTemplate()} disabled={!manage} />

      <div className="my-2 border-t border-ink-700" />

      <SettingsToggleRow
        icon={Shield}
        label="Protect Doc"
        checked={!!doc.isProtected}
        onChange={(v) => void run(async () => { await setProtected(doc.id, v); toast.success(v ? 'Document protected' : 'Protection removed') })}
        disabled={!manage || busy}
      />
      <SettingsToggleRow
        icon={Globe}
        label="Public sharing"
        checked={share.publicEnabled}
        onChange={(v) => void run(async () => { await togglePublic(v); toast.success(v ? 'Public link enabled' : 'Public link disabled') })}
        disabled={!manage || busy}
      />
      <SettingsToggleRow
        icon={BookOpen}
        label="Mark Doc as wiki"
        checked={!!doc.isWiki}
        onChange={(v) => void run(async () => { await updateDocument(doc.id, { isWiki: v }); toast.success(v ? 'Marked as wiki' : 'Removed wiki mark') })}
        disabled={!manage || busy}
      />

      <div className="my-2 border-t border-ink-700" />

      <SettingsRow icon={Archive} label="Archive" onClick={() => void run(async () => { await archive([doc.id]); toast.success('Archived'); onClose() })} disabled={!manage || archived || busy} />
      <SettingsRow icon={Trash2} label="Delete" danger onClick={onDelete} disabled={!manage || busy} />
    </>
  )

  const pageTab = (
    <>
      <SettingsRow icon={Pencil} label="Rename page" onClick={onRename} disabled={!manage} />
      <SettingsRow icon={Link2} label="Copy link" onClick={() => void copyLink()} />
      <SettingsRow
        icon={Star}
        label="Favorite"
        trailing={<Toggle checked={favorite} onChange={() => toggleFavorite(doc.id, 'doc')} />}
      />
      <SettingsRow icon={Copy} label="Duplicate page" onClick={onDuplicate} disabled={!manage || busy} />
      <SettingsRow
        icon={FolderInput}
        label="Move page"
        chevron
        disabled={!manage || (moveFolders.length === 0 && !doc.folderId)}
        onClick={() => setExpanded((v) => (v === 'move' ? null : 'move'))}
      />
      {expanded === 'move' && manage && (
        <div className="ml-7 space-y-0.5 border-l border-ink-700 pl-2">
          {doc.folderId && (
            <SettingsRow
              icon={FolderInput}
              label="Move to root"
              onClick={() => void run(async () => { await moveDocument(doc.id, null); toast.success('Moved'); onClose() })}
            />
          )}
          {moveFolders.map((f) => (
            <SettingsRow
              key={f.id}
              icon={FolderInput}
              label={f.name}
              onClick={() => void run(async () => { await moveDocument(doc.id, f.id); toast.success('Moved'); onClose() })}
            />
          ))}
        </div>
      )}
      <SettingsRow
        icon={Upload}
        label="Import"
        chevron
        disabled={!manage}
        onClick={() => setExpanded((v) => (v === 'import' ? null : 'import'))}
      />
      {expanded === 'import' && manage && (
        <div className="ml-7 border-l border-ink-700 pl-2">
          <SettingsRow icon={Upload} label="Import file into this page" onClick={() => fileInputRef.current?.click()} />
        </div>
      )}
      <SettingsRow
        icon={Download}
        label="Export page"
        chevron
        onClick={() => setExpanded((v) => (v === 'export' ? null : 'export'))}
      />
      {expanded === 'export' && (
        <div className="ml-7 space-y-0.5 border-l border-ink-700 pl-2">
          {[...DOC_EXPORT_FORMATS, ...DOC_EXPORT_EXTRA_FORMATS].map((item) => (
            <SettingsRow key={item.format} icon={Download} label={item.label} onClick={() => void onExport(item.format)} />
          ))}
        </div>
      )}

      <div className="my-2 border-t border-ink-700" />

      <SettingsRow icon={Wand2} label="Apply a template" onClick={() => { onClose(); navigate('/app/docs/templates') }} />
      <SettingsRow icon={LayoutTemplate} label="Save as template" onClick={() => void onSaveAsTemplate()} disabled={!manage} />

      <div className="my-2 border-t border-ink-700" />

      <SettingsRow
        icon={Clock}
        label="Show page history"
        onClick={() => { onClose(); onOpenHistory?.() }}
      />
      <SettingsToggleRow
        icon={Shield}
        label="Protect page"
        checked={!!doc.isProtected}
        onChange={(v) => void run(async () => { await setProtected(doc.id, v); toast.success(v ? 'Page protected' : 'Protection removed') })}
        disabled={!manage || busy}
      />

      <div className="my-2 border-t border-ink-700" />

      <SettingsRow icon={Archive} label="Archive page" onClick={() => void run(async () => { await archive([doc.id]); toast.success('Archived'); onClose() })} disabled={!manage || archived || busy} />
      <SettingsRow icon={Trash2} label="Delete page" danger onClick={onDelete} disabled={!manage || busy} />
    </>
  )

  return (
    <Modal open={open} onClose={onClose} width="max-w-sm">
      <input
        ref={fileInputRef}
        type="file"
        accept=".html,.htm,.md,.markdown,.txt,.text"
        className="hidden"
        onChange={(e) => void onImportFile(e.target.files?.[0])}
      />

      <h2 className="-mt-1 mb-3 text-base font-semibold text-fg">Settings</h2>

      <div className="mb-4 flex rounded-lg bg-ink-900 p-0.5">
        <button
          type="button"
          onClick={() => setTab('doc')}
          className={cn(
            'flex-1 rounded-md px-3 py-1.5 text-xs font-medium transition-colors',
            tab === 'doc' ? 'bg-ink-750 text-fg shadow-sm' : 'text-fg-muted hover:text-fg-secondary',
          )}
        >
          Entire Doc
        </button>
        <button
          type="button"
          onClick={() => setTab('page')}
          className={cn(
            'flex-1 rounded-md px-3 py-1.5 text-xs font-medium transition-colors',
            tab === 'page' ? 'bg-ink-750 text-fg shadow-sm' : 'text-fg-muted hover:text-fg-secondary',
          )}
        >
          This page
        </button>
      </div>

      <div className="max-h-[50vh] overflow-y-auto pr-1">
        {tab === 'doc' ? docTab : pageTab}
      </div>

      <button
        type="button"
        onClick={() => { onClose(); onOpenShare?.() }}
        className="mt-4 flex w-full items-center justify-center gap-2 rounded-xl bg-fg py-2.5 text-sm font-semibold text-ink-950 transition-opacity hover:opacity-90"
      >
        <Share2 size={15} />
        Sharing and Permissions
      </button>
    </Modal>
  )
}