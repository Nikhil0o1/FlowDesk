import { X } from 'lucide-react'
import { useSearchParams } from 'react-router-dom'

import {
  PEOPLE_TAB,
  PROJECT_FILTER_PARAM,
  SPACE_FILTER_PARAM,
  WORKSPACE_FILTER_PARAM,
} from '../../lib/peopleRoutes'
import type { ProjectRoleItem, SpaceRoleItem, WorkspaceRoleItem } from '../../lib/types'

type ScopeOption = { id: string; label: string; sub?: string }

export function PeopleScopeFilter({
  kind,
  options,
  activeId,
  paramKey,
}: {
  kind: 'workspace' | 'space' | 'project'
  options: ScopeOption[]
  activeId: string | null
  paramKey: typeof WORKSPACE_FILTER_PARAM | typeof SPACE_FILTER_PARAM | typeof PROJECT_FILTER_PARAM
}) {
  const [params, setParams] = useSearchParams()

  if (options.length <= 1) return null

  const label =
    kind === 'workspace' ? 'Workspace' : kind === 'space' ? 'Space' : 'Project'

  const setScope = (id: string) => {
    const next = new URLSearchParams(params)
    next.set('tab', PEOPLE_TAB)
    next.set(paramKey, id)
    if (kind === 'workspace') {
      next.delete(SPACE_FILTER_PARAM)
      next.delete(PROJECT_FILTER_PARAM)
    } else if (kind === 'space') {
      next.delete(PROJECT_FILTER_PARAM)
    }
    setParams(next, { replace: true })
  }

  const clearScope = () => {
    const next = new URLSearchParams(params)
    next.delete(paramKey)
    setParams(next, { replace: true })
  }

  const active = options.find((o) => o.id === activeId) ?? options[0]

  return (
    <div className="mt-4 flex flex-wrap items-center gap-2">
      <span className="text-xs font-medium text-fg-muted">{label}:</span>
      {options.map((opt) => (
        <button
          key={opt.id}
          type="button"
          onClick={() => setScope(opt.id)}
          className={
            opt.id === active?.id
              ? 'rounded-lg border border-brand/40 bg-brand/10 px-2.5 py-1 text-xs font-medium text-brand'
              : 'rounded-lg border border-ink-700 bg-ink-850/80 px-2.5 py-1 text-xs text-fg-secondary hover:border-ink-600 hover:text-fg'
          }
        >
          {opt.label}
        </button>
      ))}
      {active && options.length > 1 && (
        <button
          type="button"
          onClick={clearScope}
          className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-xs text-fg-muted hover:text-fg"
          title={`Reset ${label.toLowerCase()} filter`}
        >
          <X size={12} />
          Reset
        </button>
      )}
    </div>
  )
}

export function workspaceScopeOptions(rows: WorkspaceRoleItem[]): ScopeOption[] {
  return rows.map((w) => ({ id: w.workspace_id, label: w.workspace_name }))
}

export function spaceScopeOptions(rows: SpaceRoleItem[]): ScopeOption[] {
  return rows.map((s) => ({
    id: s.space_id,
    label: s.space_name,
    sub: s.workspace_name,
  }))
}

export function projectScopeOptions(rows: ProjectRoleItem[]): ScopeOption[] {
  return rows.map((p) => ({
    id: p.project_id,
    label: p.project_name,
    sub: p.space_name ?? undefined,
  }))
}
