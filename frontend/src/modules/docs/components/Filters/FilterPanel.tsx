import { useMemo, useState } from 'react'
import { ArrowDown, Filter, Plus, Search, X } from 'lucide-react'

import { cn } from '../../../../lib/utils'
import {
  DEFAULT_FILTER_OPERATOR,
  DOC_FILTER_FIELDS,
  type DocFilterField,
  type DocFilterOperator,
  type DocFilterRule,
} from '../../types/editor'
import { useDocsUIStore } from '../../stores/docsUIStore'
import { useFolders } from '../../hooks/useFolders'
import type { FlowDoc } from '../../types/document'
import { distinctContributors, distinctOwners } from '../../services/docs.service'

const TEXT_OPS: DocFilterOperator[] = ['contains', 'equals', 'not_equals']
const DATE_OPS: DocFilterOperator[] = ['on', 'before', 'after']
const IS_OPS: DocFilterOperator[] = ['is', 'is_not']

function operatorsFor(field: DocFilterField): DocFilterOperator[] {
  if (field === 'title' || field === 'tag') return TEXT_OPS
  if (field.startsWith('date')) return DATE_OPS
  return IS_OPS
}

function labelForField(field: DocFilterField): string {
  return DOC_FILTER_FIELDS.find((f) => f.id === field)?.label ?? field
}

function labelForOp(op: DocFilterOperator): string {
  const map: Record<DocFilterOperator, string> = {
    contains: 'contains',
    equals: 'equals',
    not_equals: 'does not equal',
    before: 'before',
    after: 'after',
    on: 'on',
    is: 'is',
    is_not: 'is not',
  }
  return map[op]
}

interface FilterPanelProps {
  docs: FlowDoc[]
}

/** ClickUp-style Filters button with "+ Add filter" and active rule rows. */
export function FilterPanel({ docs }: FilterPanelProps) {
  const { folders } = useFolders()
  const filterRules = useDocsUIStore((s) => s.filterRules)
  const addFilterRule = useDocsUIStore((s) => s.addFilterRule)
  const updateFilterRule = useDocsUIStore((s) => s.updateFilterRule)
  const removeFilterRule = useDocsUIStore((s) => s.removeFilterRule)
  const clearFilterRules = useDocsUIStore((s) => s.clearFilterRules)

  const [open, setOpen] = useState(false)
  const [adding, setAdding] = useState(false)
  const [fieldQuery, setFieldQuery] = useState('')

  const owners = useMemo(() => distinctOwners(docs), [docs])
  const contributors = useMemo(() => distinctContributors(docs), [docs])

  const fields = useMemo(() => {
    const q = fieldQuery.trim().toLowerCase()
    return q ? DOC_FILTER_FIELDS.filter((f) => f.label.toLowerCase().includes(q)) : DOC_FILTER_FIELDS
  }, [fieldQuery])

  const pickField = (field: DocFilterField) => {
    const defaultValue =
      field === 'wiki' ? 'true' : field === 'sharing' ? 'private' : field === 'location' ? '__root__' : ''
    addFilterRule({ field, operator: DEFAULT_FILTER_OPERATOR[field], value: defaultValue })
    setAdding(false)
    setFieldQuery('')
  }

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => {
          setOpen((o) => !o)
          setAdding(false)
        }}
        className={cn(
          'flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-sm transition-colors',
          filterRules.length > 0
            ? 'border-brand bg-brand-soft text-fg'
            : 'border-ink-700 bg-ink-800 text-fg-secondary hover:text-fg',
        )}
      >
        <Filter size={14} />
        Filters
        {filterRules.length > 0 && (
          <span className="rounded-full bg-brand px-1.5 text-[10px] font-bold text-white">{filterRules.length}</span>
        )}
      </button>

      {open && (
        <>
          <div
            className="fixed inset-0 z-40"
            onClick={() => {
              setOpen(false)
              setAdding(false)
            }}
            aria-hidden
          />
          <div className="absolute left-0 top-10 z-50 w-72 rounded-xl border border-ink-700 bg-ink-850 p-3 shadow-xl">
            <div className="mb-2 flex items-center justify-between">
              <p className="text-sm font-semibold text-fg">Filters</p>
              {filterRules.length > 0 && (
                <button type="button" onClick={clearFilterRules} className="text-xs text-fg-muted hover:text-fg">
                  Clear all
                </button>
              )}
            </div>

            {filterRules.map((rule) => (
              <FilterRuleRow
                key={rule.id}
                rule={rule}
                folders={folders}
                owners={owners}
                contributors={contributors}
                onChange={(patch) => updateFilterRule(rule.id, patch)}
                onRemove={() => removeFilterRule(rule.id)}
              />
            ))}

            <div className="relative mt-1">
              <button
                type="button"
                onClick={() => setAdding((a) => !a)}
                className="flex w-full items-center gap-1.5 rounded-lg px-2 py-1.5 text-sm text-brand hover:bg-ink-750"
              >
                <Plus size={14} /> Add filter
              </button>
              {adding && (
                <div className="absolute left-full top-0 z-50 ml-2 w-56 overflow-hidden rounded-xl border border-ink-700 bg-ink-850 shadow-xl">
                  <div className="border-b border-ink-700 p-2">
                    <div className="relative">
                      <Search size={13} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-fg-muted" />
                      <input
                        autoFocus
                        value={fieldQuery}
                        onChange={(e) => setFieldQuery(e.target.value)}
                        placeholder="Search..."
                        className="input-dark w-full py-1.5 pl-8 text-xs"
                      />
                    </div>
                  </div>
                  <ul className="max-h-64 overflow-y-auto py-1">
                    {fields.map((f) => (
                      <li key={f.id}>
                        <button
                          type="button"
                          onClick={() => pickField(f.id)}
                          className="flex w-full px-3 py-2 text-left text-sm text-fg-secondary hover:bg-ink-750 hover:text-fg"
                        >
                          {f.label}
                        </button>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  )
}

function FilterRuleRow({
  rule,
  folders,
  owners,
  contributors,
  onChange,
  onRemove,
}: {
  rule: DocFilterRule
  folders: { id: string; name: string; parentId: string | null }[]
  owners: { id: string; name: string }[]
  contributors: { id: string; name: string }[]
  onChange: (patch: Partial<Omit<DocFilterRule, 'id'>>) => void
  onRemove: () => void
}) {
  const ops = operatorsFor(rule.field)

  return (
    <div className="mb-2 rounded-lg border border-ink-700 bg-ink-800 p-2">
      <div className="mb-1.5 flex items-center justify-between gap-2">
        <span className="text-xs font-semibold text-fg">{labelForField(rule.field)}</span>
        <button type="button" aria-label="Remove filter" onClick={onRemove} className="text-fg-muted hover:text-fg">
          <X size={13} />
        </button>
      </div>
      <div className="flex flex-wrap items-center gap-1.5">
        <select
          aria-label="Filter operator"
          value={rule.operator}
          onChange={(e) => onChange({ operator: e.target.value as DocFilterOperator })}
          className="rounded border border-ink-700 bg-ink-850 px-2 py-0.5 text-xs"
        >
          {ops.map((op) => (
            <option key={op} value={op}>
              {labelForOp(op)}
            </option>
          ))}
        </select>
        <FilterValueInput
          rule={rule}
          folders={folders}
          owners={owners}
          contributors={contributors}
          onChange={onChange}
        />
      </div>
    </div>
  )
}

function FilterValueInput({
  rule,
  folders,
  owners,
  contributors,
  onChange,
}: {
  rule: DocFilterRule
  folders: { id: string; name: string }[]
  owners: { id: string; name: string }[]
  contributors: { id: string; name: string }[]
  onChange: (patch: Partial<Omit<DocFilterRule, 'id'>>) => void
}) {
  if (rule.field === 'location') {
    return (
      <select
        aria-label="Folder location"
        value={rule.value}
        onChange={(e) => onChange({ value: e.target.value })}
        className="min-w-0 flex-1 rounded border border-ink-700 bg-ink-850 px-2 py-0.5 text-xs"
      >
        <option value="__root__">Root</option>
        {folders.map((f) => (
          <option key={f.id} value={f.id}>
            {f.name}
          </option>
        ))}
      </select>
    )
  }
  if (rule.field === 'owner') {
    return (
      <select
        aria-label="Owner"
        value={rule.value}
        onChange={(e) => onChange({ value: e.target.value })}
        className="min-w-0 flex-1 rounded border border-ink-700 bg-ink-850 px-2 py-0.5 text-xs"
      >
        <option value="">Select owner</option>
        {owners.map((o) => (
          <option key={o.id} value={o.id}>
            {o.name}
          </option>
        ))}
      </select>
    )
  }
  if (rule.field === 'contributors') {
    return (
      <select
        aria-label="Contributor"
        value={rule.value}
        onChange={(e) => onChange({ value: e.target.value })}
        className="min-w-0 flex-1 rounded border border-ink-700 bg-ink-850 px-2 py-0.5 text-xs"
      >
        <option value="">Select contributor</option>
        {contributors.map((c) => (
          <option key={c.id} value={c.id}>
            {c.name}
          </option>
        ))}
      </select>
    )
  }
  if (rule.field === 'sharing') {
    return (
      <select
        aria-label="Sharing"
        value={rule.value}
        onChange={(e) => onChange({ value: e.target.value })}
        className="rounded border border-ink-700 bg-ink-850 px-2 py-0.5 text-xs"
      >
        <option value="private">Private</option>
        <option value="shared">Shared</option>
        <option value="public">Public link</option>
      </select>
    )
  }
  if (rule.field === 'wiki') {
    return (
      <select
        aria-label="Wiki"
        value={rule.value}
        onChange={(e) => onChange({ value: e.target.value })}
        className="rounded border border-ink-700 bg-ink-850 px-2 py-0.5 text-xs"
      >
        <option value="true">Yes</option>
        <option value="false">No</option>
      </select>
    )
  }
  if (rule.field.startsWith('date')) {
    return (
      <input
        type="date"
        aria-label="Date"
        value={rule.value.slice(0, 10)}
        onChange={(e) => onChange({ value: e.target.value })}
        className="rounded border border-ink-700 bg-ink-850 px-2 py-0.5 text-xs"
      />
    )
  }
  return (
    <input
      type="text"
      aria-label="Filter value"
      value={rule.value}
      onChange={(e) => onChange({ value: e.target.value })}
      placeholder={rule.field === 'title' ? 'Enter title…' : 'Enter tag…'}
      className="min-w-0 flex-1 rounded border border-ink-700 bg-ink-850 px-2 py-0.5 text-xs"
    />
  )
}
