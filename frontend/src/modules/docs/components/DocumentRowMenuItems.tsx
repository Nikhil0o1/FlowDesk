import {
  Archive,
  ArchiveRestore,
  Copy,
  CornerUpLeft,
  Download,
  ExternalLink,
  Folder as FolderIcon,
  FolderInput,
  LayoutTemplate,
  Link2,
  Pencil,
  RotateCcw,
  Share2,
  Shield,
  Star,
  Trash2,
} from 'lucide-react'
import { useNavigate } from 'react-router-dom'

import type { MenuItem } from '../../../components/ui/ContextMenu'
import { useArchive } from '../hooks/useArchive'
import { useDocTemplates } from '../hooks/useDocTemplates'
import { useDocuments } from '../hooks/useDocuments'
import { useFavorites } from '../hooks/useFavorites'
import { useFolders } from '../hooks/useFolders'
import { useTrash } from '../hooks/useTrash'
import {
  DOC_EXPORT_EXTRA_FORMATS,
  DOC_EXPORT_FORMATS,
  exportDocument,
} from '../services/docExport.service'
import type { FlowDoc } from '../types/document'
import type { DocCardContext } from '../types/editor'
import { toast } from '../../../stores/toast'

/** Shared row context-menu items for DocumentCard and DocsTable. */
export function useDocumentRowMenuItems(
  doc: FlowDoc,
  context: DocCardContext,
  opts: {
    onRename?: (doc: FlowDoc) => void
    onPurge?: (doc: FlowDoc) => void
    onShare?: (doc: FlowDoc) => void
    copyLink: () => void
    open: () => void
  },
): MenuItem[] {
  const navigate = useNavigate()
  const { folders } = useFolders()
  const { duplicateDocument, moveDocument, deleteDocument, setProtected } = useDocuments()
  const { isFavorite, toggleFavorite } = useFavorites()
  const { archive, unarchive } = useArchive()
  const { restore } = useTrash()
  const { saveAsTemplate } = useDocTemplates()
  const favorite = isFavorite(doc.id)

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

  if (context === 'trash') {
    return [
      { type: 'action', label: 'Restore', icon: <RotateCcw size={14} />, onClick: () => restore([doc.id]) },
      { type: 'separator' },
      {
        type: 'action',
        label: 'Delete permanently',
        icon: <Trash2 size={14} />,
        danger: true,
        onClick: () => opts.onPurge?.(doc),
      },
    ]
  }
  if (context === 'archive') {
    return [
      { type: 'action', label: 'Open', icon: <ExternalLink size={14} />, onClick: opts.open },
      { type: 'action', label: 'Unarchive', icon: <ArchiveRestore size={14} />, onClick: () => unarchive([doc.id]) },
      {
        type: 'toggle',
        label: 'Favorite',
        icon: <Star size={14} />,
        checked: favorite,
        onToggle: () => toggleFavorite(doc.id, 'doc'),
      },
      { type: 'separator' },
      { type: 'action', label: 'Delete', icon: <Trash2 size={14} />, danger: true, onClick: () => deleteDocument(doc.id) },
    ]
  }

  const moveChildren: MenuItem[] = [
    ...(doc.folderId
      ? [{ type: 'action' as const, label: 'Move to root', icon: <CornerUpLeft size={14} />, onClick: () => moveDocument(doc.id, null) }, { type: 'separator' as const }]
      : []),
    ...folders
      .filter((f) => f.id !== doc.folderId)
      .map(
        (f): MenuItem => ({
          type: 'action',
          label: f.name,
          icon: <FolderIcon size={14} />,
          onClick: () => moveDocument(doc.id, f.id),
        }),
      ),
  ]

  return [
    { type: 'action', label: 'Open', icon: <ExternalLink size={14} />, onClick: opts.open },
    { type: 'action', label: 'Rename', icon: <Pencil size={14} />, onClick: () => opts.onRename?.(doc) },
    { type: 'action', label: 'Copy link', icon: <Link2 size={14} />, onClick: opts.copyLink },
    ...(opts.onShare
      ? [{ type: 'action' as const, label: 'Share', icon: <Share2 size={14} />, onClick: () => opts.onShare?.(doc) }]
      : []),
    {
      type: 'toggle',
      label: 'Favorite',
      icon: <Star size={14} />,
      checked: favorite,
      onToggle: () => toggleFavorite(doc.id, 'doc'),
    },
    { type: 'submenu', label: 'Move', icon: <FolderInput size={14} />, disabled: moveChildren.length === 0, children: moveChildren },
    { type: 'action', label: 'Duplicate', icon: <Copy size={14} />, onClick: () => duplicateDocument(doc.id) },
    {
      type: 'submenu',
      label: 'Templates',
      icon: <LayoutTemplate size={14} />,
      children: [
        { type: 'action', label: 'Save as template', icon: <LayoutTemplate size={14} />, onClick: onSaveAsTemplate },
        { type: 'action', label: 'Apply a template', icon: <LayoutTemplate size={14} />, onClick: () => navigate('/app/docs/templates') },
      ],
    },
    {
      type: 'submenu',
      label: 'Export',
      icon: <Download size={14} />,
      children: [
        ...DOC_EXPORT_FORMATS.map(
          (item): MenuItem => ({
            type: 'action',
            label: item.label,
            icon: <Download size={14} />,
            onClick: () => void exportDocument(doc, item.format).catch(() => toast.error('Export failed')),
          }),
        ),
        { type: 'separator' },
        ...DOC_EXPORT_EXTRA_FORMATS.map(
          (item): MenuItem => ({
            type: 'action',
            label: item.label,
            icon: <Download size={14} />,
            onClick: () => void exportDocument(doc, item.format).catch(() => toast.error('Export failed')),
          }),
        ),
      ],
    },
    { type: 'action', label: 'Archive', icon: <Archive size={14} />, onClick: () => archive([doc.id]) },
    { type: 'separator' },
    {
      type: 'toggle',
      label: 'Protect Doc',
      icon: <Shield size={14} />,
      checked: !!doc.isProtected,
      onToggle: () => setProtected(doc.id, !doc.isProtected),
    },
    { type: 'action', label: 'Delete', icon: <Trash2 size={14} />, danger: true, onClick: () => deleteDocument(doc.id) },
  ]
}
