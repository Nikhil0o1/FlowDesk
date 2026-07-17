import { useEffect, useRef, useState } from 'react'
import { BookOpen, ChevronDown, FileText, FolderPlus, LayoutTemplate, Loader2 } from 'lucide-react'
import { createPortal } from 'react-dom'
import { useNavigate } from 'react-router-dom'

import { RenameModal } from '../../../components/ui/RenameModal'
import { cn } from '../../../lib/utils'
import { toast } from '../../../stores/toast'
import { useDocuments } from '../hooks/useDocuments'
import { useFolders } from '../hooks/useFolders'

interface NewDocMenuProps {
  folderId?: string | null
}

/** Primary "New Doc" split button with create options dropdown. */
export function NewDocMenu({ folderId = null }: NewDocMenuProps) {
  const navigate = useNavigate()
  const { createDocument } = useDocuments()
  const { addFolder } = useFolders()
  const anchorRef = useRef<HTMLDivElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [creatingFolder, setCreatingFolder] = useState(false)
  const [menuPos, setMenuPos] = useState({ top: 0, left: 0 })

  const createDoc = async (isWiki = false) => {
    if (busy) return
    setOpen(false)
    setBusy(true)
    try {
      const doc = await createDocument({ folderId, isWiki })
      navigate(`/app/docs/${doc.id}`)
    } catch {
      toast.error('Could not create document')
    } finally {
      setBusy(false)
    }
  }

  const openMenu = () => {
    const rect = anchorRef.current?.getBoundingClientRect()
    if (!rect) return
    setMenuPos({
      top: rect.bottom + 6,
      left: Math.max(8, rect.right - 208),
    })
    setOpen(true)
  }

  useEffect(() => {
    if (!open) return
    const onPointerDown = (e: MouseEvent) => {
      const target = e.target as Node
      if (anchorRef.current?.contains(target) || menuRef.current?.contains(target)) return
      setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false)
    const onScroll = (e: Event) => {
      if (menuRef.current?.contains(e.target as Node)) return
      setOpen(false)
    }
    const onResize = () => setOpen(false)
    document.addEventListener('mousedown', onPointerDown)
    document.addEventListener('keydown', onKey)
    window.addEventListener('scroll', onScroll, true)
    window.addEventListener('resize', onResize)
    return () => {
      document.removeEventListener('mousedown', onPointerDown)
      document.removeEventListener('keydown', onKey)
      window.removeEventListener('scroll', onScroll, true)
      window.removeEventListener('resize', onResize)
    }
  }, [open])

  return (
    <>
      <div ref={anchorRef} className={cn('btn-new-doc', busy && 'opacity-80')}>
        <button
          type="button"
          disabled={busy}
          onClick={() => void createDoc(false)}
          className="btn-new-doc-segment gap-1.5 px-3.5"
        >
          {busy ? <Loader2 size={14} className="animate-spin" /> : null}
          New Doc
        </button>
        <button
          type="button"
          aria-label="More create options"
          aria-haspopup="menu"
          aria-expanded={open}
          disabled={busy}
          onClick={() => (open ? setOpen(false) : openMenu())}
          className="btn-new-doc-segment btn-new-doc-divider w-8"
        >
          <ChevronDown size={14} strokeWidth={2.25} />
        </button>
      </div>

      {open &&
        createPortal(
          <div
            ref={menuRef}
            role="menu"
            className="menu-panel fixed z-[90] w-52"
            style={{ top: menuPos.top, left: menuPos.left }}
          >
            <Item icon={FileText} label="Create Doc" onClick={() => void createDoc(false)} />
            <Item icon={BookOpen} label="Create Wiki" onClick={() => void createDoc(true)} />
            <Item
              icon={FolderPlus}
              label="Create Folder"
              onClick={() => {
                setOpen(false)
                setCreatingFolder(true)
              }}
            />
            <Item
              icon={LayoutTemplate}
              label="Apply a template"
              onClick={() => {
                setOpen(false)
                navigate('/app/docs/templates')
              }}
            />
          </div>,
          document.body,
        )}

      <RenameModal
        open={creatingFolder}
        onClose={() => setCreatingFolder(false)}
        title={folderId ? 'New subfolder' : 'New folder'}
        label="Folder name"
        initialName=""
        onSave={async (name) => {
          try {
            const folder = await addFolder(name, folderId)
            setCreatingFolder(false)
            navigate(`/app/docs/folder/${folder.id}`)
            toast.success('Folder created')
          } catch {
            toast.error('Could not create folder')
          }
        }}
      />
    </>
  )
}

function Item({ icon: Icon, label, onClick }: { icon: typeof FileText; label: string; onClick: () => void }) {
  return (
    <button type="button" role="menuitem" onClick={onClick} className="menu-item">
      <Icon size={15} className="shrink-0" />
      <span className="flex-1">{label}</span>
    </button>
  )
}
