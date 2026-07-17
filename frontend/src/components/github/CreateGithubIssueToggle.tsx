import { useQuery } from '@tanstack/react-query'
import { Github } from 'lucide-react'
import { useCallback, useState } from 'react'

import { api } from '../../lib/api'
import { cn } from '../../lib/utils'

const GITHUB_ISSUE_PREF_KEY = 'flowdesk:create-github-issue'

export function useCreateGithubIssuePreference() {
  const [checked, setCheckedState] = useState(() => {
    try {
      return localStorage.getItem(GITHUB_ISSUE_PREF_KEY) === '1'
    } catch {
      return false
    }
  })

  const setChecked = useCallback((value: boolean) => {
    setCheckedState(value)
    try {
      localStorage.setItem(GITHUB_ISSUE_PREF_KEY, value ? '1' : '0')
    } catch {
      /* ignore storage errors */
    }
  }, [])

  return [checked, setChecked] as const
}

type LinkedRepo = { id: string; repo_full_name: string; is_active: boolean }

function ToggleSwitch({
  checked,
  onChange,
  disabled,
  id,
}: {
  checked: boolean
  onChange: (value: boolean) => void
  disabled?: boolean
  id?: string
}) {
  return (
    <button
      id={id}
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

export function useProjectGithubLinked(projectId: string | undefined) {
  return useQuery({
    queryKey: ['gh-proj-repos', projectId],
    queryFn: () => api.get<LinkedRepo[]>(`/github/projects/${projectId}/repositories`),
    enabled: !!projectId,
    select: (repos) => repos.some((repo) => repo.is_active),
    staleTime: 60_000,
  })
}

export function GithubIssueToolbarToggle({
  projectId,
  checked,
  onChange,
}: {
  projectId: string
  checked: boolean
  onChange: (value: boolean) => void
}) {
  const linked = useProjectGithubLinked(projectId)
  if (!linked.data) return null

  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      title={checked ? 'New tasks will also create GitHub issues' : 'New tasks stay in FlowDesk only'}
      onClick={() => onChange(!checked)}
      className={cn(
        'flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium transition-colors',
        checked ? 'bg-brand-soft text-brand' : 'text-fg-secondary hover:bg-ink-750 hover:text-fg',
      )}
    >
      <Github size={13} />
      GitHub issue
      <span
        className={cn(
          'relative ml-0.5 h-4 w-7 shrink-0 rounded-full transition-colors',
          checked ? 'bg-brand' : 'bg-ink-600',
        )}
      >
        <span
          className={cn(
            'absolute top-0.5 h-3 w-3 rounded-full bg-white transition-all',
            checked ? 'left-3.5' : 'left-0.5',
          )}
        />
      </span>
    </button>
  )
}

export function CreateGithubIssueToggle({
  projectId,
  checked,
  onChange,
  compact = false,
  subIssue = false,
  disabled = false,
}: {
  projectId: string
  checked: boolean
  onChange: (value: boolean) => void
  compact?: boolean
  subIssue?: boolean
  disabled?: boolean
}) {
  const linked = useProjectGithubLinked(projectId)
  if (!linked.data) return null

  const label = subIssue ? 'Create GitHub sub-issue' : 'Create GitHub issue'

  if (compact) {
    return (
      <button
        type="button"
        title={checked ? `${label} (on)` : `${label} (off)`}
        aria-label={label}
        aria-pressed={checked}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className={cn(
          'rounded-md border p-1.5 transition-colors disabled:opacity-50',
          checked
            ? 'border-brand/40 bg-brand/10 text-brand'
            : 'border-ink-600 text-fg-muted hover:border-fg-muted hover:text-fg',
        )}
      >
        <Github size={12} />
      </button>
    )
  }

  return (
    <label className="flex items-center justify-between gap-3 rounded-xl border border-ink-700 bg-ink-850 px-3 py-2.5">
      <span className="flex min-w-0 items-center gap-2 text-sm text-fg-secondary">
        <Github size={15} className="shrink-0 text-fg-muted" />
        <span>{label}</span>
      </span>
      <ToggleSwitch checked={checked} onChange={onChange} disabled={disabled} />
    </label>
  )
}
