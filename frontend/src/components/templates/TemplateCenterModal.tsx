import { ArrowLeft, FolderGit2, Layers, RefreshCw, Search, Sparkles, Star, X } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'

import { errorMessage } from '../../lib/api'
import { STARTER_TEMPLATES, type StarterTemplate } from '../../lib/starterTemplates'
import {
  applyStarterTemplate,
  applyTemplate,
  listTemplates,
  updateTemplate,
  type Template,
  type TemplateApplyResult,
  type TemplateIncludes,
  type TemplateKind,
} from '../../lib/templates'
import { cn } from '../../lib/utils'
import { toast } from '../../stores/toast'

interface SpaceLite {
  id: string
  name: string
  color: string
}

interface Props {
  open: boolean
  onClose: () => void
  mode: 'apply' | 'update'
  kind: TemplateKind
  workspaceId: string | undefined
  source: { id: string; name: string } | null
  spaces: SpaceLite[]
  defaultSpaceId?: string
  onDone?: (result?: TemplateApplyResult) => void
}

/** Normalized card across saved (DB) and starter (app-shipped) templates. */
interface Card {
  src: 'saved' | 'starter'
  id: string
  name: string
  kind: TemplateKind
  description: string
  color: string
  category: string
  complexity?: string
  includes: TemplateIncludes
  saved?: Template
  starter?: StarterTemplate
}

function starterIncludes(t: StarterTemplate): TemplateIncludes {
  return {
    projects: 0,
    statuses: t.payload.statuses.length,
    custom_fields: t.payload.custom_fields.length,
    lists: t.payload.lists.length,
    tasks: t.payload.tasks.length,
  }
}

function includesSummary(kind: TemplateKind, inc: TemplateIncludes): string {
  const parts: string[] = []
  if (kind === 'space' && inc.projects) parts.push(`${inc.projects} project${inc.projects === 1 ? '' : 's'}`)
  if (inc.statuses) parts.push(`${inc.statuses} statuses`)
  if (inc.custom_fields) parts.push(`${inc.custom_fields} fields`)
  if (inc.lists) parts.push(`${inc.lists} lists`)
  if (inc.tasks) parts.push(`${inc.tasks} tasks`)
  return parts.join(' · ')
}

type Tab = 'featured' | 'yours' | 'starter'

export function TemplateCenterModal({
  open,
  onClose,
  mode,
  kind,
  workspaceId,
  source,
  spaces,
  defaultSpaceId,
  onDone,
}: Props) {
  const [saved, setSaved] = useState<Template[]>([])
  const [loading, setLoading] = useState(false)
  const [tab, setTab] = useState<Tab>('featured')
  const [query, setQuery] = useState('')
  const [selected, setSelected] = useState<Card | null>(null)
  const [applyName, setApplyName] = useState('')
  const [targetSpaceId, setTargetSpaceId] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!open) return
    setSelected(null)
    setQuery('')
    setTab(mode === 'update' ? 'yours' : 'featured')
    if (!workspaceId) return
    setLoading(true)
    listTemplates(workspaceId, mode === 'update' ? kind : undefined)
      .then(setSaved)
      .catch((err) => toast.error(errorMessage(err)))
      .finally(() => setLoading(false))
  }, [open, workspaceId, mode, kind])

  useEffect(() => {
    if (selected) {
      setApplyName(selected.name.replace(/ Template$/i, ''))
      setTargetSpaceId(defaultSpaceId || spaces[0]?.id || '')
    }
  }, [selected])

  const savedCards: Card[] = useMemo(
    () =>
      saved.map((t) => ({
        src: 'saved',
        id: t.id,
        name: t.name,
        kind: t.kind,
        description: t.description || '',
        color: t.color,
        category: 'Your Templates',
        includes: t.includes || { projects: 0, statuses: 0, custom_fields: 0, lists: 0, tasks: 0 },
        saved: t,
      })),
    [saved],
  )
  const starterCards: Card[] = useMemo(
    () =>
      STARTER_TEMPLATES.map((t) => ({
        src: 'starter',
        id: t.id,
        name: t.name,
        kind: 'project',
        description: t.description,
        color: t.color,
        category: t.category,
        complexity: t.complexity,
        includes: starterIncludes(t),
        starter: t,
      })),
    [],
  )

  const matchesQuery = (c: Card) =>
    !query.trim() ||
    c.name.toLowerCase().includes(query.toLowerCase()) ||
    c.description.toLowerCase().includes(query.toLowerCase()) ||
    c.category.toLowerCase().includes(query.toLowerCase())

  const visibleCards = useMemo(() => {
    let pool: Card[]
    if (tab === 'yours') pool = savedCards
    else if (tab === 'featured') pool = starterCards.filter((c) => c.starter?.featured)
    else pool = starterCards
    return pool.filter(matchesQuery)
  }, [tab, savedCards, starterCards, query])

  // Group by category for display.
  const grouped = useMemo(() => {
    const m = new Map<string, Card[]>()
    for (const c of visibleCards) {
      const g = m.get(c.category) || []
      g.push(c)
      m.set(c.category, g)
    }
    return Array.from(m.entries())
  }, [visibleCards])

  const doApply = async () => {
    if (!selected) return
    if (selected.kind === 'project' && !targetSpaceId) {
      toast.error('Choose a space to create the project in')
      return
    }
    setBusy(true)
    try {
      let result: TemplateApplyResult
      if (selected.src === 'saved') {
        result = await applyTemplate(selected.id, {
          name: applyName.trim() || undefined,
          target_space_id: selected.kind === 'project' ? targetSpaceId : undefined,
        })
      } else {
        result = await applyStarterTemplate({
          kind: 'project',
          name: applyName.trim() || selected.name,
          payload: selected.starter!.payload,
          target_space_id: targetSpaceId,
        })
      }
      toast.success(`Created “${result.name}” from template`)
      onDone?.(result)
      onClose()
    } catch (err) {
      toast.error(errorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  const doUpdate = async (t: Template) => {
    if (!source) return
    setBusy(true)
    try {
      await updateTemplate(t.id, { resync_from_source_id: source.id })
      toast.success(`“${t.name}” updated from ${source.name}`)
      onDone?.()
      onClose()
    } catch (err) {
      toast.error(errorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  if (!open) return null

  const TabButton = ({ id, label, count, icon }: { id: Tab; label: string; count: number; icon: React.ReactNode }) => (
    <button
      onClick={() => {
        setTab(id)
        setSelected(null)
      }}
      className={cn(
        'flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-sm transition-colors',
        tab === id ? 'bg-brand-soft font-medium text-fg' : 'text-fg-secondary hover:bg-ink-750 hover:text-fg',
      )}
    >
      <span className={tab === id ? 'text-brand' : 'text-fg-muted'}>{icon}</span>
      <span className="flex-1">{label}</span>
      <span className="text-xs text-fg-muted">{count}</span>
    </button>
  )

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-6"
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className="flex h-[80vh] w-full max-w-4xl flex-col overflow-hidden rounded-2xl border border-ink-700 bg-ink-850 shadow-popover">
        {/* Header */}
        <div className="flex shrink-0 items-center justify-between border-b border-ink-700 px-5 py-3.5">
          <h2 className="text-base font-semibold text-fg">
            {mode === 'update' ? 'Update existing template' : 'Template Center'}
          </h2>
          <button onClick={onClose} className="rounded-lg p-1 text-fg-muted hover:bg-ink-750 hover:text-fg">
            <X size={18} />
          </button>
        </div>

        <div className="flex min-h-0 flex-1">
          {/* Left rail */}
          <div className="hidden w-52 shrink-0 flex-col gap-1 border-r border-ink-700 p-3 sm:flex">
            {mode === 'apply' && (
              <TabButton id="featured" label="Featured" count={starterCards.filter((c) => c.starter?.featured).length} icon={<Star size={15} />} />
            )}
            <TabButton id="yours" label="Your Templates" count={savedCards.length} icon={<Layers size={15} />} />
            {mode === 'apply' && (
              <TabButton id="starter" label="Starter Templates" count={starterCards.length} icon={<Sparkles size={15} />} />
            )}
          </div>

          {/* Content */}
          <div className="flex min-w-0 flex-1 flex-col">
            {selected ? (
              /* ---- Detail / apply config ---- */
              <div className="flex min-h-0 flex-1 flex-col overflow-y-auto p-5">
                <button
                  onClick={() => setSelected(null)}
                  className="mb-3 flex w-fit items-center gap-1.5 text-sm text-fg-secondary hover:text-fg"
                >
                  <ArrowLeft size={15} /> Back
                </button>
                <div className="flex items-start gap-3">
                  <span
                    className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl text-white"
                    style={{ backgroundColor: selected.color }}
                  >
                    {selected.kind === 'space' ? <Layers size={22} /> : <FolderGit2 size={22} />}
                  </span>
                  <div className="min-w-0 flex-1">
                    <h3 className="text-lg font-semibold text-fg">{selected.name}</h3>
                    {selected.complexity && (
                      <span className="mt-1 inline-block rounded bg-ink-700 px-2 py-0.5 text-[11px] font-medium text-fg-secondary">
                        {selected.complexity}
                      </span>
                    )}
                  </div>
                </div>
                {selected.description && <p className="mt-3 text-sm text-fg-secondary">{selected.description}</p>}

                <div className="mt-4">
                  <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-fg-muted">Template includes</p>
                  <div className="grid grid-cols-2 gap-2">
                    {[
                      ['Statuses', selected.includes.statuses],
                      ['Custom fields', selected.includes.custom_fields],
                      ['Lists', selected.includes.lists],
                      ['Seed tasks', selected.includes.tasks],
                    ].map(([label, n]) => (
                      <div key={label as string} className="flex items-center justify-between rounded-lg border border-ink-700 px-3 py-2 text-sm">
                        <span className="text-fg-secondary">{label}</span>
                        <span className="font-semibold text-fg">{n as number}</span>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="mt-5 space-y-3 rounded-xl border border-ink-700 bg-ink-900/40 p-3">
                  <div>
                    <label className="mb-1 block text-xs font-medium text-fg-secondary">New {selected.kind} name</label>
                    <input className="input-dark w-full" value={applyName} onChange={(e) => setApplyName(e.target.value)} placeholder={selected.name} />
                  </div>
                  {selected.kind === 'project' && (
                    <div>
                      <label className="mb-1 block text-xs font-medium text-fg-secondary">Create in space</label>
                      <select className="input-dark w-full" value={targetSpaceId} onChange={(e) => setTargetSpaceId(e.target.value)}>
                        {spaces.map((s) => (
                          <option key={s.id} value={s.id}>
                            {s.name}
                          </option>
                        ))}
                      </select>
                    </div>
                  )}
                  <div className="flex justify-end">
                    <button className="btn-primary" onClick={() => void doApply()} disabled={busy}>
                      {busy ? 'Applying…' : 'Use Template'}
                    </button>
                  </div>
                </div>
              </div>
            ) : (
              /* ---- Browse ---- */
              <>
                <div className="shrink-0 p-4 pb-2">
                  <div className="relative">
                    <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-fg-muted" />
                    <input
                      className="input-dark w-full pl-9"
                      placeholder="Search templates…"
                      value={query}
                      onChange={(e) => setQuery(e.target.value)}
                    />
                  </div>
                </div>
                <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-4">
                  {loading ? (
                    <div className="py-12 text-center text-sm text-fg-muted">Loading templates…</div>
                  ) : visibleCards.length === 0 ? (
                    <div className="flex flex-col items-center gap-2 py-12 text-center">
                      <Sparkles size={26} className="text-fg-muted" />
                      <p className="max-w-xs text-sm text-fg-muted">
                        {tab === 'yours'
                          ? 'No saved templates yet. Use “Save as template” on a space or project.'
                          : 'No templates match your search.'}
                      </p>
                    </div>
                  ) : mode === 'update' && tab === 'yours' ? (
                    /* Update mode: list with per-row Update button */
                    <div className="space-y-1.5">
                      {savedCards.filter(matchesQuery).map((c) => (
                        <div key={c.id} className="flex items-center gap-3 rounded-xl border border-ink-700 p-3 hover:bg-ink-750">
                          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-white" style={{ backgroundColor: c.color }}>
                            {c.kind === 'space' ? <Layers size={16} /> : <FolderGit2 size={16} />}
                          </span>
                          <div className="min-w-0 flex-1">
                            <p className="truncate text-sm font-semibold text-fg">{c.name}</p>
                            <p className="text-[11px] text-fg-muted">{includesSummary(c.kind, c.includes)}</p>
                          </div>
                          <button className="btn-secondary shrink-0 gap-1.5 text-xs" disabled={busy} onClick={() => void doUpdate(c.saved!)}>
                            <RefreshCw size={13} /> Update
                          </button>
                        </div>
                      ))}
                    </div>
                  ) : (
                    grouped.map(([category, cards]) => (
                      <div key={category} className="mb-5">
                        <p className="mb-2 text-sm font-semibold text-fg">{category}</p>
                        <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
                          {cards.map((c) => (
                            <button
                              key={`${c.src}-${c.id}`}
                              onClick={() => setSelected(c)}
                              className="flex items-start gap-3 rounded-xl border border-ink-700 p-3 text-left transition-colors hover:border-brand hover:bg-ink-750"
                            >
                              <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-white" style={{ backgroundColor: c.color }}>
                                {c.kind === 'space' ? <Layers size={17} /> : <FolderGit2 size={17} />}
                              </span>
                              <div className="min-w-0 flex-1">
                                <div className="flex items-center gap-2">
                                  <p className="truncate text-sm font-semibold text-fg">{c.name}</p>
                                  {c.complexity && (
                                    <span className="shrink-0 rounded bg-ink-700 px-1.5 py-0.5 text-[10px] text-fg-muted">{c.complexity}</span>
                                  )}
                                </div>
                                {c.description && <p className="mt-0.5 line-clamp-2 text-xs text-fg-secondary">{c.description}</p>}
                                <p className="mt-1 text-[11px] text-fg-muted">{includesSummary(c.kind, c.includes)}</p>
                              </div>
                            </button>
                          ))}
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </>
            )}
          </div>
        </div>
      </div>
    </div>,
    document.body,
  )
}
