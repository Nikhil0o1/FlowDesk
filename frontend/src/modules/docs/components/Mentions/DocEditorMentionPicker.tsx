import { useEffect, useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import {
  Building2,
  FileText,
  Folder,
  Hash,
  Loader2,
  MapPin,
  Presentation,
  User,
  Users,
} from 'lucide-react'
import { createPortal } from 'react-dom'

import { Avatar } from '../../../../components/ui/Avatar'
import { useChannels, useCurrentContext, useWorkspaceMembers, useWhiteboards } from '../../../../lib/queries'
import { cn } from '../../../../lib/utils'
import { useFolders } from '../../hooks/useFolders'
import { fetchDocuments, fetchRecentTasksForLink, searchTasksForLink } from '../../services/docsApi.service'
import {
  DOC_MENTION_TABS,
  type DocMentionTab,
  type DocMentionTrigger,
} from './docEditorMention'

interface DocEditorMentionPickerProps {
  trigger: DocMentionTrigger
  highlightIndex: number
  onHighlight: (index: number) => void
  onPick: (tab: DocMentionTab, id: string, label: string, href?: string) => void
  onClose: () => void
}

type MentionRow = {
  id: string
  label: string
  sub?: string
  href?: string
  icon?: React.ReactNode
}

export function DocEditorMentionPicker({
  trigger,
  highlightIndex,
  onHighlight,
  onPick,
  onClose,
}: DocEditorMentionPickerProps) {
  const [tab, setTab] = useState<DocMentionTab>(trigger.tab)
  const { workspace } = useCurrentContext()
  const wsId = workspace?.id
  const q = trigger.query.trim().toLowerCase()

  const { data: members } = useWorkspaceMembers(wsId)
  const { folders } = useFolders()
  const channels = useChannels(wsId)
  const whiteboards = useWhiteboards(wsId)

  const tasksQuery = useQuery({
    queryKey: ['doc-mention-tasks', q],
    queryFn: () => searchTasksForLink(q),
    enabled: tab === 'tasks' && q.length >= 2,
    staleTime: 15_000,
  })

  const recentTasksQuery = useQuery({
    queryKey: ['doc-mention-recent-tasks', wsId],
    queryFn: () => fetchRecentTasksForLink(wsId),
    enabled: tab === 'tasks' && q.length < 2,
    staleTime: 30_000,
  })

  const docsQuery = useQuery({
    queryKey: ['doc-mention-docs', wsId, q],
    queryFn: () =>
      fetchDocuments(wsId!, {
        q: q || undefined,
        deleted: false,
        archived: false,
        sort: 'updated',
        sortDir: 'desc',
      }),
    enabled: tab === 'docs' && !!wsId,
    staleTime: 15_000,
  })

  const rows = useMemo((): MentionRow[] => {
    switch (tab) {
      case 'people': {
        const people = (members ?? [])
          .filter((m) => {
            const name = (m.user?.full_name || m.user?.email || '').toLowerCase()
            return !q || name.includes(q)
          })
          .slice(0, 12)
          .map((m) => ({
            id: m.user_id,
            label: m.user?.full_name || m.user?.email || 'Member',
            sub: m.user?.email,
            icon: (
              <Avatar
                name={m.user?.full_name || m.user?.email || '?'}
                src={m.user?.avatar_url}
                size={22}
              />
            ),
          }))
        const showAll =
          !q || 'all'.startsWith(q) || 'everyone'.startsWith(q)
        return [
          ...(showAll
            ? [
                {
                  id: 'all',
                  label: 'All',
                  sub: 'Everyone in this workspace',
                  icon: <Users size={14} className="text-brand" />,
                },
              ]
            : []),
          ...people,
        ]
      }
      case 'tasks': {
        const tasks =
          q.length >= 2
            ? (tasksQuery.data ?? [])
            : (recentTasksQuery.data ?? []).filter(
                (t) => !q || t.title.toLowerCase().includes(q),
              )
        return tasks.slice(0, 12).map((t) => ({
          id: t.id,
          label: t.title,
          sub: 'task',
          href: `/app/tasks/${t.id}`,
          icon: <Hash size={14} className="text-brand" />,
        }))
      }
      case 'docs':
        return (docsQuery.data ?? [])
          .filter((d) => !q || d.title.toLowerCase().includes(q))
          .slice(0, 12)
          .map((d) => ({
            id: d.id,
            label: d.title,
            sub: d.isWiki ? 'Wiki' : 'Doc',
            href: `/app/docs/${d.id}`,
            icon: <FileText size={14} className="text-brand" />,
          }))
      case 'whiteboards':
        return (whiteboards.data ?? [])
          .filter((b) => !q || b.name.toLowerCase().includes(q))
          .slice(0, 12)
          .map((b) => ({
            id: b.id,
            label: b.name,
            href: `/app/whiteboards/${b.id}`,
            icon: <Presentation size={14} className="text-brand" />,
          }))
      case 'locations':
        return [
          {
            id: 'workspace',
            label: workspace?.name ?? 'Workspace',
            sub: 'Everything',
            icon: <Building2 size={14} className="text-fg-muted" />,
          },
          ...folders
            .filter((f) => !q || f.name.toLowerCase().includes(q))
            .slice(0, 11)
            .map((f) => ({
              id: f.id,
              label: f.name,
              sub: 'Folder',
              href: `/app/docs/folder/${f.id}`,
              icon: <Folder size={14} className="text-fg-muted" />,
            })),
        ]
      case 'channels':
        return (channels.data ?? [])
          .filter((c) => !c.is_direct)
          .filter((c) => !q || c.name.toLowerCase().includes(q))
          .slice(0, 12)
          .map((c) => ({
            id: c.id,
            label: c.name,
            href: `/app/chat/${c.id}`,
            icon: <Hash size={14} className="text-brand" />,
          }))
      default:
        return []
    }
  }, [
    tab,
    q,
    members,
    tasksQuery.data,
    recentTasksQuery.data,
    docsQuery.data,
    whiteboards.data,
    folders,
    channels.data,
    workspace?.name,
  ])

  const loading =
    (tab === 'tasks' && (tasksQuery.isFetching || recentTasksQuery.isFetching)) ||
    (tab === 'docs' && docsQuery.isFetching)

  const safeHighlight = rows.length === 0 ? 0 : Math.min(highlightIndex, rows.length - 1)

  useEffect(() => {
    const onConfirm = (event: Event) => {
      const index = (event as CustomEvent<{ index?: number }>).detail?.index ?? safeHighlight
      const row = rows[Math.min(Math.max(0, index), Math.max(0, rows.length - 1))]
      if (!row) return
      onPick(tab, row.id, row.label, row.href)
    }
    window.addEventListener('doc-mention-confirm', onConfirm)
    return () => window.removeEventListener('doc-mention-confirm', onConfirm)
  }, [onPick, rows, safeHighlight, tab])

  useEffect(() => {
    onHighlight(0)
  }, [tab, q, onHighlight])

  const panel = (
    <>
      <div className="fixed inset-0 z-[180]" onClick={onClose} aria-hidden />
      <div
        className="fixed left-1/2 top-[72px] z-[190] w-[min(520px,calc(100vw-24px))] -translate-x-1/2 overflow-hidden rounded-xl border border-ink-700 bg-ink-850 shadow-xl"
        onMouseDown={(e) => e.preventDefault()}
      >
        <div className="flex gap-1 overflow-x-auto border-b border-ink-700 px-2 pt-2">
          {DOC_MENTION_TABS.map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => {
                setTab(t.id)
                onHighlight(0)
              }}
              className={cn(
                'shrink-0 border-b-2 px-3 pb-2 text-sm font-medium transition-colors',
                tab === t.id
                  ? 'border-brand text-fg'
                  : 'border-transparent text-fg-muted hover:text-fg-secondary',
              )}
            >
              {t.label}
            </button>
          ))}
        </div>

        <div className="max-h-64 overflow-y-auto py-1">
          {tab === 'people' && (
            <p className="px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-fg-muted">
              People
            </p>
          )}
          {loading && (
            <div className="flex items-center justify-center gap-2 py-6 text-sm text-fg-muted">
              <Loader2 size={16} className="animate-spin" />
              Searching…
            </div>
          )}
          {!loading && rows.length === 0 && (
            <p className="px-3 py-4 text-sm text-fg-muted">No matches</p>
          )}
          {!loading &&
            rows.map((row, i) => (
              <button
                key={`${tab}-${row.id}`}
                type="button"
                className={cn(
                  'flex w-full items-center gap-2.5 px-3 py-2 text-left transition-colors',
                  i === safeHighlight ? 'bg-ink-750' : 'hover:bg-ink-750/70',
                )}
                onMouseEnter={() => onHighlight(i)}
                onClick={() => onPick(tab, row.id, row.label, row.href)}
              >
                {row.icon ?? <User size={14} className="text-fg-muted" />}
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm text-fg">{row.label}</span>
                  {row.sub && <span className="block truncate text-xs text-fg-muted">{row.sub}</span>}
                </span>
                {tab === 'locations' && <MapPin size={13} className="shrink-0 text-fg-muted" />}
              </button>
            ))}
        </div>

        <div className="border-t border-ink-700 bg-ink-900/50 px-3 py-2 text-[10px] text-fg-muted">
          <span className="font-medium">'@'</span> People · <span className="font-medium">'@@'</span>{' '}
          Tasks · <span className="font-medium">'@@@'</span> Docs ·{' '}
          <span className="font-medium">'@@@@'</span> Whiteboards ·{' '}
          <span className="font-medium">'@/'</span> Locations · <span className="font-medium">'#'</span>{' '}
          Channels
        </div>
      </div>
    </>
  )

  return createPortal(panel, document.body)
}
