import { memo } from 'react'
import { ChevronRight, Folder as FolderIcon, FolderOpen, MoreHorizontal, Pencil, Trash2, FolderInput, CornerUpLeft } from 'lucide-react'
import { useLocation, useNavigate } from 'react-router-dom'

import { cn } from '../../../../lib/utils'
import { useRowMenu, type MenuItem } from '../../../../components/ui/ContextMenu'
import { useFolderDocCount } from '../../hooks/useDocuments'
import { useFolders } from '../../hooks/useFolders'
import { useDocsUIStore } from '../../stores/docsUIStore'
import type { Folder, FolderNode as FolderNodeType } from '../../types/folder'

interface FolderNodeProps {
  node: FolderNodeType
  depth: number
  activeFolderId: string | null
  onRename: (folder: Folder) => void
  onDelete: (folder: Folder) => void
}

function FolderNodeBase({ node, depth, activeFolderId, onRename, onDelete }: FolderNodeProps) {
  const navigate = useNavigate()
  const { moveTargets, moveFolder } = useFolders()
  const isOpen = useDocsUIStore((s) => s.expanded[node.id] ?? false)
  const toggleExpanded = useDocsUIStore((s) => s.toggleExpanded)
  const count = useFolderDocCount(node.id)

  const isActive = activeFolderId === node.id
  const hasChildren = node.children.length > 0

  const menuItems = (): MenuItem[] => {
    const targets = moveTargets(node.id).filter((t) => t.id !== node.parentId)
    const moveChildren: MenuItem[] = [
      ...(node.parentId
        ? [
            {
              type: 'action' as const,
              label: 'Move to root',
              icon: <CornerUpLeft size={14} />,
              onClick: () => moveFolder(node.id, null),
            },
            { type: 'separator' as const },
          ]
        : []),
      ...targets.map(
        (t): MenuItem => ({
          type: 'action',
          label: t.name,
          icon: <FolderIcon size={14} />,
          onClick: () => moveFolder(node.id, t.id),
        }),
      ),
    ]
    return [
      { type: 'action', label: 'Rename', icon: <Pencil size={14} />, onClick: () => onRename(node) },
      {
        type: 'submenu',
        label: 'Move',
        icon: <FolderInput size={14} />,
        disabled: moveChildren.length === 0,
        children: moveChildren,
      },
      { type: 'separator' },
      { type: 'action', label: 'Delete', icon: <Trash2 size={14} />, danger: true, onClick: () => onDelete(node) },
    ]
  }

  const menu = useRowMenu(menuItems)

  return (
    <div>
      <div
        role="treeitem"
        aria-expanded={hasChildren ? isOpen : undefined}
        aria-selected={isActive}
        tabIndex={0}
        onContextMenu={menu.onContextMenu}
        onClick={() => navigate(`/app/docs/folder/${node.id}`)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') navigate(`/app/docs/folder/${node.id}`)
          if (e.key === 'ArrowRight' && hasChildren && !isOpen) toggleExpanded(node.id)
          if (e.key === 'ArrowLeft' && hasChildren && isOpen) toggleExpanded(node.id)
        }}
        className={cn(
          'group mx-2 flex cursor-pointer items-center gap-1 rounded-lg py-1.5 pr-1 text-sm transition-colors',
          isActive ? 'bg-brand-soft text-fg' : 'text-fg-secondary hover:bg-ink-750 hover:text-fg',
        )}
        style={{ paddingLeft: 8 + depth * 14 }}
      >
        <button
          type="button"
          aria-label={isOpen ? 'Collapse folder' : 'Expand folder'}
          onClick={(e) => {
            e.stopPropagation()
            toggleExpanded(node.id)
          }}
          className={cn(
            'flex h-4 w-4 shrink-0 items-center justify-center rounded text-fg-muted transition-transform hover:text-fg',
            !hasChildren && 'invisible',
            isOpen && 'rotate-90',
          )}
        >
          <ChevronRight size={13} />
        </button>
        {isOpen && hasChildren ? (
          <FolderOpen size={15} className="shrink-0 text-amber-400" />
        ) : (
          <FolderIcon size={15} className="shrink-0 text-amber-400" />
        )}
        <span className="min-w-0 flex-1 truncate">{node.name}</span>
        {count > 0 && <span className="shrink-0 text-[11px] text-fg-muted">{count}</span>}
        <button
          type="button"
          aria-label="Folder actions"
          onClick={menu.onTriggerClick}
          className="flex h-5 w-5 shrink-0 items-center justify-center rounded text-fg-muted opacity-0 transition-opacity hover:bg-ink-700 hover:text-fg group-hover:opacity-100"
        >
          <MoreHorizontal size={14} />
        </button>
      </div>

      {isOpen &&
        node.children.map((child) => (
          <FolderNode
            key={child.id}
            node={child}
            depth={depth + 1}
            activeFolderId={activeFolderId}
            onRename={onRename}
            onDelete={onDelete}
          />
        ))}
      {menu.node}
    </div>
  )
}

export const FolderNode = memo(FolderNodeBase)
