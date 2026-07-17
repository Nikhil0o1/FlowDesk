import { useCallback, useMemo, useState } from 'react'
import { FilePlus2, FileText, FolderPlus, MoreHorizontal, Pencil, SearchX, Share2, Trash2 } from 'lucide-react'
import { useNavigate, useParams } from 'react-router-dom'

import { useCurrentContext, useWorkspaceMembers } from '../../../lib/queries'
import { EmptyState } from '../../../components/ui/EmptyState'
import { RenameModal } from '../../../components/ui/RenameModal'
import { useRowMenu, type MenuItem } from '../../../components/ui/ContextMenu'
import { toast } from '../../../stores/toast'
import { useDocs } from '../context/DocsContext'
import { useDocFiltering } from '../hooks/useDocFiltering'
import { searchDocuments as filterDocsByQuery } from '../services/docs.service'
import { CenteredSpinner } from '../../../components/ui/Spinner'
import { DocsBreadcrumb, type Crumb } from '../components/DocsBreadcrumb'
import { DocCollection } from '../components/DocCollection'
import { DocsHeaderActions } from '../components/DocsHeaderActions'
import { DocsToolbar } from '../components/DocsToolbar'
import { FolderCard, CreateFolderCard } from '../components/FolderCard'
import { ConfirmDialog } from '../components/ConfirmDialog'
import { ShareDocFolderModal } from '../components/Sharing/ShareDocFolderModal'
import type { Folder } from '../types/folder'
import { DOC_FOLDER_DRAG_MIME } from '../constants/dnd'

export default function DocsHome() {
  const { folderId = null } = useParams()
  const navigate = useNavigate()
  const { workspace } = useCurrentContext()
  const workspaceName = workspace?.name ?? 'FlowDesk'
  const { data: workspaceMembers = [] } = useWorkspaceMembers(workspace?.id)

  const {
    folders,
    getFolder,
    folderPath,
    byFolder,
    search: sidebarSearch,
    searchDocuments,
    createDocument,
    addFolder,
    renameFolder,
    deleteFolder,
    moveDocument,
    isLoading,
  } = useDocs()

  const [tableSearch, setTableSearch] = useState('')
  const [creatingFolder, setCreatingFolder] = useState(false)
  const [renaming, setRenaming] = useState<Folder | null>(null)
  const [deleting, setDeleting] = useState<Folder | null>(null)
  const [sharing, setSharing] = useState<Folder | null>(null)
  const [dragDocId, setDragDocId] = useState<string | null>(null)
  const [overFolderId, setOverFolderId] = useState<string | null>(null)

  const currentFolder = getFolder(folderId)
  const subFolders = useMemo(() => folders.filter((f) => f.parentId === folderId), [folders, folderId])

  const scoped = useMemo(
    () => (sidebarSearch ? searchDocuments(sidebarSearch) : byFolder(folderId)),
    [sidebarSearch, searchDocuments, byFolder, folderId],
  )
  const base = useMemo(
    () => (tableSearch.trim() ? filterDocsByQuery(scoped, folders, tableSearch) : scoped),
    [scoped, folders, tableSearch],
  )

  const { result: docs } = useDocFiltering(base)

  const crumbs: Crumb[] = sidebarSearch
    ? [{ label: workspaceName, to: '/app/docs' }, { label: `Results for “${sidebarSearch}”` }]
    : [
        { label: workspaceName, to: '/app/docs' },
        ...folderPath(folderId).map((f) => ({ label: f.name, to: `/app/docs/folder/${f.id}` })),
      ]

  const heading = sidebarSearch ? 'Search results' : currentFolder ? currentFolder.name : 'All Docs'
  const locationLabel = currentFolder?.name ?? workspaceName

  const onNewDoc = () => {
    void createDocument({ folderId }).then((doc) => navigate(`/app/docs/${doc.id}`))
  }

  const handleFolderDrop = useCallback(
    async (targetFolderId: string, docId?: string | null) => {
      const id = docId || dragDocId
      if (!id) return
      try {
        await moveDocument(id, targetFolderId)
        toast.success('Moved to folder')
      } catch {
        toast.error('Could not move document')
      } finally {
        setDragDocId(null)
        setOverFolderId(null)
      }
    },
    [dragDocId, moveDocument],
  )

  const currentFolderMenuItems = (): MenuItem[] => {
    if (!currentFolder) return []
    return [
      {
        type: 'action',
        label: 'Rename',
        icon: <Pencil size={14} />,
        onClick: () => setRenaming(currentFolder),
      },
      {
        type: 'action',
        label: 'Share',
        icon: <Share2 size={14} />,
        onClick: () => setSharing(currentFolder),
      },
      { type: 'separator' },
      {
        type: 'action',
        label: 'Delete',
        icon: <Trash2 size={14} />,
        danger: true,
        onClick: () => setDeleting(currentFolder),
      },
    ]
  }
  const currentFolderMenu = useRowMenu(currentFolderMenuItems)

  const hasAnyFolders = folders.length > 0
  const showFolderShelf = !sidebarSearch && !tableSearch
  const showFolders = showFolderShelf && (subFolders.length > 0 || !folderId)
  const isEmpty = !showFolders && docs.length === 0 && !showFolderShelf

  if (isLoading) {
    return (
      <div className="mx-auto flex h-full max-w-6xl flex-col px-6 py-5">
        <CenteredSpinner />
      </div>
    )
  }

  return (
    <div className="mx-auto flex h-full max-w-6xl flex-col px-6 py-5">
      <DocsBreadcrumb items={crumbs} />

      <div className="mt-3 flex items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2">
          <h1 className="truncate text-2xl font-bold text-fg">{heading}</h1>
          {currentFolder && (
            <button
              type="button"
              aria-label="Folder actions"
              onClick={currentFolderMenu.onTriggerClick}
              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-fg-muted hover:bg-ink-750 hover:text-fg"
            >
              <MoreHorizontal size={18} />
            </button>
          )}
        </div>
        <DocsHeaderActions folderId={folderId} />
      </div>
      {currentFolderMenu.node}

      <div className="mt-4">
        <DocsToolbar
          docs={base}
          search={tableSearch}
          onSearchChange={setTableSearch}
          searchPlaceholder="Search"
        />
      </div>

      <div className="mt-4 min-h-0 flex-1 overflow-y-auto">
        {isEmpty ? (
          sidebarSearch || tableSearch ? (
            <EmptyState icon={SearchX} title="No documents found." description="Try a different search term or clear your filters." />
          ) : !hasAnyFolders ? (
            <EmptyState
              icon={FolderPlus}
              title="Create your first folder."
              description="Organize your documents into folders to keep things tidy."
              action={
                <button type="button" className="btn-primary" onClick={() => setCreatingFolder(true)}>
                  <FolderPlus size={16} /> New Folder
                </button>
              }
            />
          ) : (
            <EmptyState
              icon={FileText}
              title="Create your first document."
              description="This folder is empty. Add a document to get started."
              action={
                <button type="button" className="btn-primary" onClick={onNewDoc}>
                  <FilePlus2 size={16} /> New Doc
                </button>
              }
            />
          )
        ) : (
          <div className="space-y-6 pb-6">
            {showFolderShelf && (
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {subFolders.map((f) => (
                  <FolderCard
                    key={f.id}
                    folder={f}
                    dropTarget={!!dragDocId && overFolderId === f.id}
                    onRename={() => setRenaming(f)}
                    onShare={() => setSharing(f)}
                    onDelete={() => setDeleting(f)}
                    onDragEnter={() => {
                      if (dragDocId) setOverFolderId(f.id)
                    }}
                    onDragOver={(e) => {
                      if (!dragDocId) return
                      e.preventDefault()
                      e.dataTransfer.dropEffect = 'move'
                    }}
                    onDrop={(e) => {
                      e.preventDefault()
                      e.stopPropagation()
                      const id =
                        e.dataTransfer.getData(DOC_FOLDER_DRAG_MIME) ||
                        e.dataTransfer.getData('text/plain') ||
                        dragDocId
                      void handleFolderDrop(f.id, id)
                    }}
                    onDragLeave={() => {
                      if (overFolderId === f.id) setOverFolderId(null)
                    }}
                  />
                ))}
                <CreateFolderCard onClick={() => setCreatingFolder(true)} />
              </div>
            )}

            {(docs.length > 0 || !showFolderShelf) && (
              <DocCollection
                docs={docs}
                view="list"
                context="active"
                query={tableSearch || sidebarSearch}
                selectable
                workspaceName={locationLabel}
                draggableDocs
                onDocDragStart={(id) => setDragDocId(id)}
                onDocDragEnd={() => {
                  setDragDocId(null)
                  setOverFolderId(null)
                }}
              />
            )}

            {showFolderShelf && docs.length === 0 && subFolders.length === 0 && (
              <EmptyState
                icon={FileText}
                title="Create your first document."
                description="Add a document or drop one onto a folder once you have docs."
                action={
                  <button type="button" className="btn-primary" onClick={onNewDoc}>
                    <FilePlus2 size={16} /> New Doc
                  </button>
                }
              />
            )}
          </div>
        )}
      </div>

      <RenameModal
        open={creatingFolder}
        onClose={() => setCreatingFolder(false)}
        title={folderId ? 'New subfolder' : 'New folder'}
        label="Folder name"
        initialName=""
        onSave={async (name) => {
          await addFolder(name, folderId)
          setCreatingFolder(false)
        }}
      />
      <RenameModal
        open={!!renaming}
        onClose={() => setRenaming(null)}
        title="Rename folder"
        label="Folder name"
        initialName={renaming?.name ?? ''}
        onSave={async (name) => {
          if (renaming) await renameFolder(renaming.id, name)
          setRenaming(null)
        }}
      />
      <ConfirmDialog
        open={!!deleting}
        onClose={() => setDeleting(null)}
        title="Delete folder"
        message={`Delete "${deleting?.name}" and everything inside it? Documents inside will move to Trash.`}
        onConfirm={() => {
          if (!deleting) return
          const id = deleting.id
          void deleteFolder(id).then(() => {
            if (folderId === id) navigate('/app/docs')
          })
        }}
      />
      {sharing && (
        <ShareDocFolderModal
          open={!!sharing}
          onClose={() => setSharing(null)}
          folderId={sharing.id}
          folderName={sharing.name}
          workspaceName={workspaceName}
          members={workspaceMembers}
        />
      )}
    </div>
  )
}
