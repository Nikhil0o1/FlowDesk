import { useMemo } from 'react'
import { BookOpen, FileText, LayoutTemplate } from 'lucide-react'
import { useNavigate } from 'react-router-dom'

import { toast } from '../../../stores/toast'
import { useDocuments } from '../hooks/useDocuments'
import { useTemplates } from '../hooks/useTemplates'

interface TemplatesRowProps {
  folderId?: string | null
}

/** Horizontal quick-start template strip shown atop the All Docs landing page. */
export function TemplatesRow({ folderId = null }: TemplatesRowProps) {
  const navigate = useNavigate()
  const { createFromTemplate } = useTemplates()
  const { createDocument } = useDocuments()

  const featured = useMemo(
    () => [
      { id: 't-project-proposal', name: 'Project Overview', description: 'Summarize goals, scope, and milestones', icon: FileText },
      { id: 't-meeting-notes', name: 'Meeting Notes', description: 'Capture an agenda, notes, and action items', icon: LayoutTemplate },
      { id: 'wiki', name: 'Wiki', description: 'Organize information in one place', icon: BookOpen },
    ],
    [],
  )

  const use = async (id: string) => {
    try {
      if (id === 'wiki') {
        const doc = await createDocument({ folderId, isWiki: true, title: 'New Wiki' })
        navigate(`/app/docs/${doc.id}`)
        return
      }
      const doc = await createFromTemplate(id, folderId)
      if (doc) navigate(`/app/docs/${doc.id}`)
    } catch {
      toast.error('Could not create from template')
    }
  }

  return (
    <section>
      <p className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-fg-muted">Templates</p>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        {featured.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => void use(t.id)}
            className="flex items-start gap-3 rounded-xl border border-ink-700 bg-ink-800 p-3 text-left transition-colors hover:border-ink-600 hover:bg-ink-750"
          >
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-brand-soft text-brand">
              <t.icon size={18} />
            </span>
            <span className="min-w-0">
              <span className="flex items-center gap-1 text-sm font-semibold text-fg">{t.name}</span>
              <span className="mt-0.5 block truncate text-xs text-fg-muted">{t.description}</span>
            </span>
          </button>
        ))}
      </div>
    </section>
  )
}
