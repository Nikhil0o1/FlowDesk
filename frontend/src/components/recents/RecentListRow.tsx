import { ExternalLink, Link2, List, SquareCheck } from 'lucide-react'
import { useNavigate } from 'react-router-dom'

import { copyRecentItemLink, recentItemPath, type RecentItem } from '../../lib/recents'
import { openAppPath } from '../../lib/safeUrl'
import { timeAgo } from '../../lib/utils'
import { toast } from '../../stores/toast'

export function RecentListRow({ item }: { item: RecentItem }) {
  const navigate = useNavigate()
  const path = recentItemPath(item)

  const open = () => navigate(path)

  const openNewTab = (e: React.MouseEvent) => {
    e.stopPropagation()
    openAppPath(path)
  }

  const copyLink = async (e: React.MouseEvent) => {
    e.stopPropagation()
    try {
      await copyRecentItemLink(item)
      toast.success('Link copied')
    } catch {
      toast.error('Could not copy link')
    }
  }

  return (
    <li>
      <div
        role="button"
        tabIndex={0}
        onClick={open}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault()
            open()
          }
        }}
        className="group flex w-full cursor-pointer items-center gap-2.5 rounded-lg px-2 py-2 text-left text-sm transition-colors hover:bg-ink-800"
      >
        <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-ink-800 text-fg-muted">
          {item.type === 'task' ? <SquareCheck size={13} /> : <List size={13} />}
        </span>
        <span className="min-w-0 flex-1 truncate text-fg">
          {item.type === 'task' && item.sublabel ? (
            <>
              <span className="text-fg-muted">{item.sublabel}</span>{' '}
              {item.label}
            </>
          ) : (
            item.label
          )}
          {item.type === 'project' && item.sublabel && (
            <span className="text-fg-muted"> · in {item.sublabel}</span>
          )}
        </span>
        <span className="shrink-0 text-[10px] text-fg-muted group-hover:hidden">
          {timeAgo(new Date(item.ts).toISOString())}
        </span>
        <div className="hidden shrink-0 items-center gap-0.5 group-hover:flex">
          <button
            type="button"
            className="btn-ghost !p-1.5 text-fg-muted hover:text-fg"
            title="Open in new tab"
            aria-label="Open in new tab"
            onClick={openNewTab}
          >
            <ExternalLink size={14} />
          </button>
          <button
            type="button"
            className="btn-ghost !p-1.5 text-fg-muted hover:text-fg"
            title="Copy link"
            aria-label="Copy link"
            onClick={(e) => void copyLink(e)}
          >
            <Link2 size={14} />
          </button>
        </div>
      </div>
    </li>
  )
}
