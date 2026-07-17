import { Hash, Lock } from 'lucide-react'
import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'

import type { Channel } from '../../lib/types'
import { cn } from '../../lib/utils'
import { useAllChannels } from '../../services/channels.service'
import { ErrorState } from '../../components/home/ErrorState'
import { HomePageHeader } from '../../components/home/HomePageHeader'
import { SearchInput } from '../../components/home/SearchInput'
import { EmptyState } from '../../components/ui/EmptyState'
import { Skeleton } from '../../components/ui/Skeleton'

type ChannelFilter = 'all' | 'public' | 'private' | 'unread'

const FILTERS: { key: ChannelFilter; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'public', label: 'Public' },
  { key: 'private', label: 'Private' },
  { key: 'unread', label: 'Unread' },
]

export default function AllChannelsPage() {
  const { data, isLoading, error } = useAllChannels()
  const navigate = useNavigate()
  const [q, setQ] = useState('')
  const [filter, setFilter] = useState<ChannelFilter>('all')

  const visible = useMemo(() => {
    const query = q.trim().toLowerCase()
    return data.filter((c) => {
      if (filter === 'public' && c.is_private) return false
      if (filter === 'private' && !c.is_private) return false
      if (filter === 'unread' && c.unread_count === 0) return false
      if (query && !c.name.toLowerCase().includes(query)) return false
      return true
    })
  }, [data, q, filter])

  return (
    <div className="mx-auto max-w-4xl px-8 py-7">
      <HomePageHeader title="All Channels" description="Browse and open every channel in your workspace." />

      <div className="flex flex-wrap items-center gap-2">
        <SearchInput value={q} onChange={setQ} placeholder="Search channels" className="max-w-xs flex-1" />
        <div className="flex rounded-lg border border-ink-700 bg-ink-850 p-0.5">
          {FILTERS.map((f) => (
            <button
              key={f.key}
              onClick={() => setFilter(f.key)}
              aria-pressed={filter === f.key}
              className={cn(
                'rounded-md px-3 py-1.5 text-xs font-medium transition-colors',
                filter === f.key ? 'bg-brand-soft text-fg' : 'text-fg-secondary hover:text-fg',
              )}
            >
              {f.label}
            </button>
          ))}
        </div>
      </div>

      <div className="mt-6">
        {isLoading ? (
          <div className="space-y-2">
            {Array.from({ length: 5 }).map((_, i) => (
              <Skeleton key={i} className="h-16 w-full rounded-xl" />
            ))}
          </div>
        ) : error ? (
          <ErrorState />
        ) : visible.length === 0 ? (
          <EmptyState
            icon={Hash}
            title={q || filter !== 'all' ? 'No matching channels' : 'No channels available'}
            description="Channels you can access will appear here."
          />
        ) : (
          <div className="space-y-2">
            {visible.map((channel) => (
              <ChannelCard
                key={channel.id}
                channel={channel}
                onOpen={() => navigate(`/app/chat?channel=${channel.id}`)}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

function ChannelCard({ channel, onOpen }: { channel: Channel; onOpen: () => void }) {
  return (
    <div className="flex items-center gap-3 rounded-xl border border-ink-700 bg-ink-850/60 px-4 py-3 transition-colors hover:border-ink-600">
      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-ink-800 text-fg-muted">
        {channel.is_private ? <Lock size={16} /> : <Hash size={16} />}
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <p className="truncate text-sm font-semibold text-fg">{channel.name}</p>
          {channel.unread_count > 0 && (
            <span className="rounded-full bg-pink-500 px-1.5 text-[10px] font-bold text-white">
              {channel.unread_count > 99 ? '99+' : channel.unread_count}
            </span>
          )}
        </div>
        <p className="truncate text-xs text-fg-muted">
          {channel.description || `${channel.member_count} member${channel.member_count === 1 ? '' : 's'}`}
        </p>
      </div>
      <button className="btn-secondary !py-1.5 text-xs" onClick={onOpen}>
        Open
      </button>
    </div>
  )
}
