import { useMemo, useState } from 'react'
import { LayoutTemplate, Trash2 } from 'lucide-react'
import { useNavigate } from 'react-router-dom'

import { useCurrentContext } from '../../../lib/queries'
import { toast } from '../../../stores/toast'
import { EmptyState } from '../../../components/ui/EmptyState'
import { useDocsBootstrap } from '../context/DocsContext'
import { useDocTemplates } from '../hooks/useDocTemplates'
import { useTemplates } from '../hooks/useTemplates'
import { DocsBreadcrumb, type Crumb } from '../components/DocsBreadcrumb'
import { SearchBox } from '../components/Search/SearchBox'
import { TemplateCard } from '../components/Templates/TemplateCard'
import { TemplatePreviewModal } from '../components/Templates/TemplatePreviewModal'
import type { DocTemplate } from '../types/template'

/** Built-in + custom template library: use, preview or duplicate a template into a doc. */
export default function TemplatesPage() {
  useDocsBootstrap()
  const navigate = useNavigate()
  const { workspace } = useCurrentContext()
  const workspaceName = workspace?.name ?? 'FlowDesk'
  const { search, createFromTemplate } = useTemplates()
  const { templates: custom, applyTemplate, deleteTemplate } = useDocTemplates()
  const [query, setQuery] = useState('')
  const [preview, setPreview] = useState<DocTemplate | null>(null)

  const results = useMemo(() => search(query), [search, query])
  const customResults = useMemo(() => {
    const q = query.trim().toLowerCase()
    return q ? custom.filter((t) => t.name.toLowerCase().includes(q)) : custom
  }, [custom, query])

  const use = (template: DocTemplate) => {
    void createFromTemplate(template.id).then((doc) => {
      if (doc) navigate(`/app/docs/${doc.id}`)
    })
  }

  const useCustom = (id: string) => {
    void applyTemplate(id).then((doc) => navigate(`/app/docs/${doc.id}`))
  }

  const removeCustom = async (id: string, name: string) => {
    if (!window.confirm(`Delete template "${name}"?`)) return
    try {
      await deleteTemplate(id)
      toast.success('Template deleted')
    } catch {
      toast.error('Could not delete template')
    }
  }

  const crumbs: Crumb[] = [{ label: workspaceName, to: '/app/docs' }, { label: 'Templates' }]

  return (
    <div className="mx-auto flex h-full max-w-6xl flex-col px-6 py-5">
      <DocsBreadcrumb items={crumbs} />

      <div className="mt-3">
        <h1 className="text-2xl font-bold text-fg">Templates</h1>
        <p className="mt-1 text-sm text-fg-secondary">Start faster with a ready-made structure.</p>
      </div>

      <div className="mt-4">
        <SearchBox value={query} onChange={setQuery} placeholder="Search templates" ariaLabel="Search templates" className="w-56" />
      </div>

      <div className="mt-4 min-h-0 flex-1 overflow-y-auto pb-6">
        {customResults.length > 0 && (
          <section className="mb-6">
            <h2 className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-fg-muted">My templates</h2>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {customResults.map((t) => (
                <div
                  key={t.id}
                  className="group flex flex-col justify-between rounded-xl border border-ink-700 bg-ink-800 p-4 transition-colors hover:border-ink-600"
                >
                  <div className="min-w-0">
                    <h3 className="flex items-center gap-1.5 truncate text-sm font-semibold text-fg">
                      {t.icon && <span>{t.icon}</span>}
                      {t.name}
                    </h3>
                    {t.description && <p className="mt-1 line-clamp-2 text-xs text-fg-muted">{t.description}</p>}
                  </div>
                  <div className="mt-3 flex items-center gap-2">
                    <button type="button" className="btn-primary !py-1 text-xs" onClick={() => useCustom(t.id)}>
                      Use template
                    </button>
                    <button
                      type="button"
                      aria-label={`Delete ${t.name}`}
                      className="rounded-lg p-1.5 text-fg-muted transition-colors hover:bg-ink-700 hover:text-rose-400"
                      onClick={() => void removeCustom(t.id, t.name)}
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </section>
        )}

        {results.length === 0 && customResults.length === 0 ? (
          <EmptyState icon={LayoutTemplate} title="No templates." description="Try a different search term." />
        ) : (
          <section>
            {customResults.length > 0 && (
              <h2 className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-fg-muted">Built-in templates</h2>
            )}
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {results.map((t) => (
                <TemplateCard
                  key={t.id}
                  template={t}
                  onUse={() => use(t)}
                  onPreview={() => setPreview(t)}
                  onDuplicate={() => use(t)}
                />
              ))}
            </div>
          </section>
        )}
      </div>

      <TemplatePreviewModal
        template={preview}
        onClose={() => setPreview(null)}
        onUse={(t) => {
          setPreview(null)
          use(t)
        }}
      />
    </div>
  )
}
