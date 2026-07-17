import { useQueryClient } from '@tanstack/react-query'
import {
  Calendar,
  Check,
  ChevronDown,
  Filter,
  Hash,
  ListChecks,
  MessageSquareText,
  RotateCcw,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'

import { cn, timeAgo } from '../../lib/utils'
import { useRealtime } from '../../lib/ws'
import {
  ASSIGNED_COMMENTS_QUERY_KEY,
  useAssignedComments,
  useSetResolved,
  type AssignedComment,
  type AssignedRelation,
  type AssignedSource,
} from '../../services/assignedComments.service'
import { ErrorState } from '../../components/home/ErrorState'
import { HomePageHeader } from '../../components/home/HomePageHeader'
import { SearchInput } from '../../components/home/SearchInput'
import { Avatar } from '../../components/ui/Avatar'
import { PriorityFlag } from '../../components/ui/badges'
import { Dropdown } from '../../components/ui/Dropdown'
import { Skeleton } from '../../components/ui/Skeleton'

type PeriodKey = 'all' | '30' | '60' | '90' | '180'

const TABS: { key: AssignedRelation; label: string }[] = [
  { key: 'assigned', label: 'Assigned to me' },
  { key: 'delegated', label: 'Delegated by me' },
]

const PERIODS: { key: PeriodKey; label: string; days: number | null }[] = [
  { key: 'all', label: 'All Time', days: null },
  { key: '30', label: 'Last 30 Days', days: 30 },
  { key: '60', label: 'Last 60 Days', days: 60 },
  { key: '90', label: 'Last 90 Days', days: 90 },
  { key: '180', label: 'Last 180 Days', days: 180 },
]

const SOURCE_META: Record<AssignedSource, { label: string; icon: LucideIcon }> = {
  task: { label: 'Tasks', icon: ListChecks },
  chat: { label: 'Chats', icon: Hash },
}

const DEFAULT_PERIOD: PeriodKey = '90'

export default function AssignedCommentsPage() {
  const [relation, setRelation] = useState<AssignedRelation>('assigned')
  const { data, isLoading, error, refetch } = useAssignedComments(relation)
  const queryClient = useQueryClient()

  const [q, setQ] = useState('')
  const [sources, setSources] = useState<Set<AssignedSource>>(new Set())
  const [showResolved, setShowResolved] = useState(false)
  const [period, setPeriod] = useState<PeriodKey>(DEFAULT_PERIOD)

  // A new @mention pushes an event to the mentioned user — refresh instantly.
  useRealtime(['mention.created', 'comment.created', 'comment.deleted'], () => {
    void queryClient.invalidateQueries({ queryKey: ASSIGNED_COMMENTS_QUERY_KEY })
  })

  const availableSources = useMemo(() => {
    const present = new Set((data ?? []).map((c) => c.source))
    return (Object.keys(SOURCE_META) as AssignedSource[]).filter((s) => present.has(s))
  }, [data])

  const periodDays = PERIODS.find((p) => p.key === period)?.days ?? null

  const visible = useMemo(() => {
    const query = q.trim().toLowerCase()
    const cutoff = periodDays ? Date.now() - periodDays * 86_400_000 : null
    return (data ?? []).filter((c) => {
      if (showResolved ? c.status !== 'resolved' : c.status !== 'pending') return false
      if (sources.size > 0 && !sources.has(c.source)) return false
      if (cutoff && new Date(c.at).getTime() < cutoff) return false
      if (
        query &&
        !c.title.toLowerCase().includes(query) &&
        !c.preview.toLowerCase().includes(query) &&
        !c.context.toLowerCase().includes(query) &&
        !(c.ref ?? '').toLowerCase().includes(query)
      )
        return false
      return true
    })
  }, [data, q, sources, showResolved, periodDays])

  const filtersActive = sources.size > 0 || period !== 'all' || showResolved || q.trim() !== ''

  const clearFilters = () => {
    setSources(new Set())
    setPeriod('all')
    setShowResolved(false)
    setQ('')
  }

  const toggleSource = (s: AssignedSource) =>
    setSources((prev) => {
      const next = new Set(prev)
      if (next.has(s)) next.delete(s)
      else next.add(s)
      return next
    })

  return (
    <div className="mx-auto max-w-4xl px-8 py-7">
      <HomePageHeader title="Assigned Comments" />

      {/* Tabs */}
      <div className="mt-1 flex gap-5 border-b border-ink-700">
        {TABS.map((t) => (
          <button
            key={t.key}
            onClick={() => setRelation(t.key)}
            className={cn(
              '-mb-px border-b-2 px-0.5 py-2 text-sm font-medium transition-colors',
              relation === t.key
                ? 'border-fg text-fg'
                : 'border-transparent text-fg-muted hover:text-fg-secondary',
            )}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* Filter row */}
      <div className="mt-4 flex flex-wrap items-center gap-2">
        <Dropdown
          width="w-48"
          trigger={
            <Chip icon={Filter} label="Filter" count={sources.size} />
          }
        >
          {() => (
            <div className="py-1">
              <p className="px-3 pb-1 pt-1.5 text-[11px] font-semibold uppercase tracking-wider text-fg-muted">
                Show
              </p>
              {availableSources.length === 0 ? (
                <p className="px-3 py-1.5 text-xs text-fg-muted">Nothing to filter</p>
              ) : (
                availableSources.map((s) => {
                  const Icon = SOURCE_META[s].icon
                  const checked = sources.has(s)
                  return (
                    <button
                      key={s}
                      onClick={() => toggleSource(s)}
                      className="flex w-full items-center gap-2.5 px-3 py-2 text-left text-sm text-fg-secondary transition-colors hover:bg-ink-750"
                    >
                      <span
                        className={cn(
                          'flex h-4 w-4 items-center justify-center rounded border',
                          checked ? 'border-brand bg-brand text-white' : 'border-ink-600',
                        )}
                      >
                        {checked && <Check size={12} strokeWidth={3} />}
                      </span>
                      <Icon size={15} className="text-fg-muted" />
                      {SOURCE_META[s].label}
                    </button>
                  )
                })
              )}
            </div>
          )}
        </Dropdown>

        <button onClick={() => setShowResolved((v) => !v)}>
          <Chip icon={Check} label="Resolved" active={showResolved} />
        </button>

        <Dropdown
          width="w-48"
          trigger={
            <Chip
              icon={Calendar}
              label={PERIODS.find((p) => p.key === period)?.label ?? 'All Time'}
              active={period !== 'all'}
              chevron
            />
          }
        >
          {(close) => (
            <div className="py-1">
              <p className="px-3 pb-1 pt-1.5 text-[11px] font-semibold uppercase tracking-wider text-fg-muted">
                Date period
              </p>
              {PERIODS.map((p) => (
                <button
                  key={p.key}
                  onClick={() => {
                    setPeriod(p.key)
                    close()
                  }}
                  className="flex w-full items-center justify-between px-3 py-2 text-left text-sm text-fg-secondary transition-colors hover:bg-ink-750"
                >
                  <span className={cn(period === p.key && 'font-semibold text-fg')}>{p.label}</span>
                  {period === p.key && <Check size={14} className="text-brand" strokeWidth={3} />}
                </button>
              ))}
            </div>
          )}
        </Dropdown>

        <div className="ml-auto">
          <SearchInput value={q} onChange={setQ} placeholder="Search" className="w-56" />
        </div>
      </div>

      {/* Results */}
      <div className="mt-5">
        {isLoading ? (
          <div className="space-y-3">
            {Array.from({ length: 3 }).map((_, i) => (
              <Skeleton key={i} className="h-24 w-full rounded-xl" />
            ))}
          </div>
        ) : error ? (
          <ErrorState onRetry={() => void refetch()} />
        ) : visible.length === 0 ? (
          <NoResults onClear={filtersActive ? clearFilters : undefined} />
        ) : (
          <div className="space-y-3">
            {visible.map((item) => (
              <AssignedItemCard key={item.id} item={item} />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

function Chip({
  icon: Icon,
  label,
  count,
  active,
  chevron,
}: {
  icon: LucideIcon
  label: string
  count?: number
  active?: boolean
  chevron?: boolean
}) {
  return (
    <span
      className={cn(
        'inline-flex cursor-pointer items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-medium transition-colors',
        active
          ? 'border-brand/50 bg-brand-soft text-brand'
          : 'border-ink-700 text-fg-secondary hover:bg-ink-750 hover:text-fg',
      )}
    >
      <Icon size={14} />
      {label}
      {count != null && count > 0 && (
        <span className="rounded-full bg-brand px-1.5 text-[10px] font-bold text-white">{count}</span>
      )}
      {chevron && <ChevronDown size={13} />}
    </span>
  )
}

function NoResults({ onClear }: { onClear?: () => void }) {
  return (
    <div className="flex flex-col items-center justify-center py-20 text-center">
      <div className="flex h-14 w-14 items-center justify-center rounded-xl border border-ink-700 text-fg-muted">
        <MessageSquareText size={24} />
      </div>
      <p className="mt-4 text-base font-semibold text-fg">No results found</p>
      {onClear && (
        <button onClick={onClear} className="btn-secondary mt-4 !py-1.5 text-xs">
          Clear filters
        </button>
      )}
    </div>
  )
}

function AssignedItemCard({ item }: { item: AssignedComment }) {
  const navigate = useNavigate()
  const setResolved = useSetResolved()
  const resolved = item.status === 'resolved'
  const SourceIcon = SOURCE_META[item.source].icon

  return (
    <div className="rounded-xl border border-ink-700 bg-ink-850/60 p-4">
      <div className="flex items-start gap-2">
        <SourceIcon size={15} className="mt-0.5 shrink-0 text-fg-muted" />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            {item.ref && <span className="font-mono text-[11px] text-fg-muted">{item.ref}</span>}
            <span className="truncate text-sm font-semibold text-fg">{item.title}</span>
            {item.priority && <PriorityFlag priority={item.priority} withLabel />}
          </div>
          <p className="mt-1.5 text-sm text-fg-secondary">{item.preview}</p>
        </div>
      </div>

      <div className="mt-3 flex items-center justify-between gap-3">
        <div className="flex items-center gap-2 text-xs text-fg-muted">
          <Avatar name={item.person.name} src={item.person.avatarUrl} size={22} />
          <span className="truncate">
            {item.person.name} · {item.context} · {timeAgo(item.at)}
          </span>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <button
            className="rounded-md p-1.5 text-fg-muted transition-colors hover:bg-ink-750 hover:text-fg"
            title={resolved ? 'Reopen' : 'Resolve'}
            aria-label={resolved ? 'Reopen' : 'Resolve'}
            disabled={setResolved.isPending}
            onClick={() => setResolved.mutate({ id: item.id, resolved: !resolved })}
          >
            {resolved ? <RotateCcw size={15} /> : <Check size={15} />}
          </button>
          <button
            className="btn-secondary !py-1.5 text-xs"
            onClick={() => navigate(item.url)}
          >
            {item.source === 'chat' ? 'Open Chat' : 'View Task'}
          </button>
        </div>
      </div>
    </div>
  )
}
