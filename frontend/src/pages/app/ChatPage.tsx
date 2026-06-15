import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  AtSign,
  Hash,
  Lock,
  MessageCircle,
  MoreHorizontal,
  Plus,
  Search,
  Send,
  Settings,
  Trash2,
  UserPlus,
  Users,
  X,
} from 'lucide-react'
import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'

import { api, errorMessage } from '../../lib/api'
import { useChannels, useCurrentContext } from '../../lib/queries'
import type { Channel, ChatMessage, OrgMember, Page } from '../../lib/types'
import { cn, formatDateTime, renderMentions } from '../../lib/utils'
import { realtime, useRealtime } from '../../lib/ws'
import { useAuthStore } from '../../stores/auth'
import { toast } from '../../stores/toast'
import { useUIStore } from '../../stores/ui'
import { Avatar } from '../../components/ui/Avatar'
import { Dropdown } from '../../components/ui/Dropdown'
import { EmptyState } from '../../components/ui/EmptyState'
import { Modal } from '../../components/ui/Modal'
import { CenteredSpinner } from '../../components/ui/Spinner'

interface ChannelMember {
  id: string
  user_id: string
  role: string
  user: { id: string; email: string; full_name: string; avatar_url: string | null } | null
}

export default function ChatPage() {
  const { org, workspace } = useCurrentContext()
  const channels = useChannels(workspace?.id)
  const [params, setParams] = useSearchParams()
  const queryClient = useQueryClient()
  const [createOpen, setCreateOpen] = useState(params.get('new') === '1')
  const canManage =
    workspace?.my_role === 'admin' || workspace?.my_role === 'owner' || org?.my_role === 'owner'

  const channelId = params.get('channel') ?? channels.data?.[0]?.id ?? null
  const channel = channels.data?.find((c) => c.id === channelId) ?? null

  const selectChannel = (id: string) => {
    params.set('channel', id)
    params.delete('new')
    setParams(params, { replace: true })
  }

  useRealtime('chat.message.created', () => {
    void queryClient.invalidateQueries({ queryKey: ['channels', workspace?.id] })
  })

  return (
    <div className="flex h-full">
      {/* Channel list */}
      <div className="flex w-60 shrink-0 flex-col border-r border-ink-700 bg-ink-850/50">
        <div className="flex items-center justify-between px-4 py-3.5">
          <h2 className="text-sm font-bold text-fg">Chat</h2>
          {canManage && (
            <button className="btn-ghost !p-1.5" onClick={() => setCreateOpen(true)} title="New channel">
              <Plus size={15} />
            </button>
          )}
        </div>
        <div className="flex-1 overflow-y-auto px-2 pb-4">
          <p className="px-2 pb-1 text-[11px] font-semibold uppercase tracking-wider text-fg-muted">
            Channels
          </p>
          {(channels.data ?? []).map((c) => (
            <button
              key={c.id}
              onClick={() => selectChannel(c.id)}
              className={cn(
                'flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-sm transition-colors',
                c.id === channelId
                  ? 'bg-brand-soft font-medium text-fg'
                  : 'text-fg-secondary hover:bg-ink-750',
              )}
            >
              {c.is_private ? <Lock size={13} className="shrink-0 text-fg-muted" /> : <Hash size={13} className="shrink-0 text-fg-muted" />}
              <span className="flex-1 truncate text-left">{c.name}</span>
              {c.unread_count > 0 && c.id !== channelId && (
                <span className="rounded-full bg-pink-500 px-1.5 text-[10px] font-bold text-white">
                  {c.unread_count}
                </span>
              )}
            </button>
          ))}
        </div>
      </div>

      {/* Conversation */}
      {channel ? (
        <Conversation key={channel.id} channel={channel} />
      ) : channels.isLoading ? (
        <div className="flex-1">
          <CenteredSpinner />
        </div>
      ) : (
        <div className="flex-1">
          <EmptyState
            icon={MessageCircle}
            title="No channels yet"
            description={
              canManage
                ? 'Create a channel to start chatting with your team.'
                : 'A workspace admin can create channels for your team.'
            }
            action={
              canManage ? (
                <button className="btn-primary" onClick={() => setCreateOpen(true)}>
                  <Plus size={14} /> New channel
                </button>
              ) : undefined
            }
          />
        </div>
      )}

      <CreateChannelModal
        open={createOpen && canManage}
        onClose={() => setCreateOpen(false)}
        workspaceId={workspace?.id}
        onCreated={(id) => selectChannel(id)}
      />
    </div>
  )
}

function Conversation({ channel }: { channel: Channel }) {
  const queryClient = useQueryClient()
  const user = useAuthStore((s) => s.user)
  const setSearchOpen = useUIStore((s) => s.setSearchOpen)
  const [body, setBody] = useState('')
  const [mentionMap, setMentionMap] = useState<Map<string, string>>(new Map())
  const [typingUsers, setTypingUsers] = useState<Map<string, number>>(new Map())
  const [bannerDismissed, setBannerDismissed] = useState(
    () => localStorage.getItem(`flowdesk-chat-banner-${channel.id}`) === '1',
  )
  const [membersOpen, setMembersOpen] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const bottomRef = useRef<HTMLDivElement>(null)
  const composerRef = useRef<ComposerHandle>(null)
  const lastTypingSent = useRef(0)

  const messages = useQuery({
    queryKey: ['messages', channel.id],
    queryFn: () => api.get<Page<ChatMessage>>(`/channels/${channel.id}/messages?page_size=100`),
  })

  const members = useQuery({
    queryKey: ['channel-members', channel.id],
    queryFn: () => api.get<ChannelMember[]>(`/channels/${channel.id}/members`),
  })

  useRealtime(
    'chat.message.created',
    (event) => {
      if (event.payload.channel_id === channel.id) {
        void queryClient.invalidateQueries({ queryKey: ['messages', channel.id] })
        if (event.payload.author_id !== user?.id) {
          void api.post(`/channels/${channel.id}/read`, { message_id: event.payload.message_id })
        }
      }
    },
    [channel.id, user?.id],
  )

  useRealtime(
    'chat.typing',
    (event) => {
      if (event.channel_id === channel.id && event.payload.user_id !== user?.id) {
        setTypingUsers((prev) => {
          const next = new Map(prev)
          next.set(event.payload.user_id, Date.now())
          return next
        })
      }
    },
    [channel.id, user?.id],
  )

  useEffect(() => {
    const id = setInterval(() => {
      setTypingUsers((prev) => {
        const next = new Map(prev)
        let changed = false
        for (const [uid, ts] of next) {
          if (Date.now() - ts > 3500) {
            next.delete(uid)
            changed = true
          }
        }
        return changed ? next : prev
      })
    }, 1200)
    return () => clearInterval(id)
  }, [])

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
    const items = messages.data?.items
    if (items?.length) {
      const last = items[items.length - 1]
      void api.post(`/channels/${channel.id}/read`, { message_id: last.id }).then(() => {
        void queryClient.invalidateQueries({ queryKey: ['channels'] })
      })
    }
  }, [messages.data?.items.length, channel.id])

  const serializeMentions = (text: string): string => {
    if (mentionMap.size === 0) return text
    // Replace longest names first so "@Alice Smith" wins over "@Alice".
    const entries = [...mentionMap.entries()].sort((a, b) => b[0].length - a[0].length)
    let out = text
    for (const [name, id] of entries) {
      const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
      // Match "@Name" only when not immediately followed by a word char,
      // so "@John" doesn't accidentally match inside "@Johnny".
      out = out.replace(new RegExp(`@${escaped}(?!\\w)`, 'g'), `@[${name}](${id})`)
    }
    return out
  }

  const send = useMutation({
    mutationFn: () =>
      api.post<ChatMessage>(`/channels/${channel.id}/messages`, {
        body: serializeMentions(body.trim()),
      }),
    onSuccess: () => {
      setBody('')
      setMentionMap(new Map())
      void queryClient.invalidateQueries({ queryKey: ['messages', channel.id] })
    },
    onError: (err) => toast.error(errorMessage(err)),
  })

  const onTyping = () => {
    const now = Date.now()
    if (now - lastTypingSent.current > 2000) {
      lastTypingSent.current = now
      realtime.send({ type: 'chat.typing', channel_id: channel.id })
    }
  }

  const typingNames = useMemo(() => {
    const nameById = new Map(
      (members.data ?? []).map((m) => [m.user_id, m.user?.full_name || 'Someone']),
    )
    return [...typingUsers.keys()].map((uid) => nameById.get(uid) ?? 'Someone')
  }, [typingUsers, members.data])

  const dismissBanner = () => {
    setBannerDismissed(true)
    localStorage.setItem(`flowdesk-chat-banner-${channel.id}`, '1')
  }

  const items = messages.data?.items ?? []
  const channelLabel = channel.name[0].toUpperCase() + channel.name.slice(1)

  return (
    <div className="flex min-w-0 flex-1 flex-col">
      {/* ---- Channel header: title row + tab row ---- */}
      <div className="shrink-0 border-b border-ink-700 px-5 pt-3">
        <div className="flex items-center gap-1.5">
          {channel.is_private ? (
            <Lock size={17} className="text-fg-secondary" />
          ) : (
            <Hash size={17} className="text-fg-secondary" />
          )}
          <h2 className="text-base font-bold text-fg">{channelLabel}</h2>
          <Dropdown
            width="w-44"
            trigger={
              <button className="rounded-md p-1 text-fg-muted transition-colors hover:bg-ink-750 hover:text-fg" title="Channel options">
                <MoreHorizontal size={15} />
              </button>
            }
          >
            {(close) => (
              <>
                <button
                  className="menu-item"
                  onClick={() => {
                    close()
                    setSettingsOpen(true)
                  }}
                >
                  <Settings size={14} /> Settings
                </button>
                <button
                  className="menu-item"
                  onClick={() => {
                    close()
                    setMembersOpen(true)
                  }}
                >
                  <Users size={14} /> Members
                </button>
              </>
            )}
          </Dropdown>

          <span className="flex-1" />

          {/* Floating quick panel (Members / Search / Settings) */}
          <Dropdown
            align="right"
            width="w-52"
            trigger={
              <button className="flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-fg-muted transition-colors hover:bg-ink-750 hover:text-fg" title="Channel panel">
                <Users size={16} />
                <span className="text-xs">{channel.member_count}</span>
              </button>
            }
          >
            {(close) => (
              <div className="py-0.5">
                <button
                  className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left text-sm font-medium text-fg transition-colors hover:bg-ink-750"
                  onClick={() => {
                    close()
                    setMembersOpen(true)
                  }}
                >
                  {members.data?.[0]?.user ? (
                    <Avatar
                      name={members.data[0].user.full_name || members.data[0].user.email}
                      src={members.data[0].user.avatar_url}
                      size={20}
                    />
                  ) : (
                    <Users size={16} className="text-fg-secondary" />
                  )}
                  Members
                  <span className="ml-auto text-xs font-normal text-fg-muted">{channel.member_count}</span>
                </button>
                <button
                  className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left text-sm font-medium text-fg transition-colors hover:bg-ink-750"
                  onClick={() => {
                    close()
                    setSearchOpen(true)
                  }}
                >
                  <Search size={16} className="text-fg-secondary" /> Search
                </button>
                <button
                  className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left text-sm font-medium text-fg transition-colors hover:bg-ink-750"
                  onClick={() => {
                    close()
                    setSettingsOpen(true)
                  }}
                >
                  <Settings size={16} className="text-fg-secondary" /> Settings
                </button>
              </div>
            )}
          </Dropdown>
        </div>

        {/* Tab bar */}
        <div className="mt-1.5 flex">
          <span className="flex items-center gap-1.5 border-b-2 border-brand px-1 pb-2 text-sm font-medium text-fg">
            <Hash size={14} className="text-fg-secondary" /> Channel
          </span>
        </div>
      </div>

      {/* ---- Messages / empty state ---- */}
      <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
        {messages.isLoading ? (
          <CenteredSpinner />
        ) : items.length === 0 ? (
          <div className="flex h-full items-center justify-center">
            <div className="w-full max-w-lg">
              <h2 className="text-xl font-bold text-fg">Chat in #{channelLabel}</h2>
              <p className="mt-2 text-[15px] leading-relaxed text-fg-secondary">
                Collaborate seamlessly across tasks and conversations. Start chatting with your team
                or connect tasks to stay on top of your work.
              </p>
              <button
                onClick={() => setMembersOpen(true)}
                className="mt-6 flex w-full items-center justify-center gap-2 rounded-xl border border-ink-600 bg-transparent py-2.5 text-sm font-semibold text-fg transition-colors hover:bg-ink-800"
              >
                <Plus size={15} /> Add People
              </button>
            </div>
          </div>
        ) : (
          <div className="space-y-0.5">
            {items.map((message, i) => {
              const prev = items[i - 1]
              const grouped =
                prev &&
                prev.author_id === message.author_id &&
                new Date(message.created_at).getTime() - new Date(prev.created_at).getTime() < 5 * 60_000
              return (
                <div
                  key={message.id}
                  className={cn('group flex gap-3 rounded-lg px-2 py-0.5 hover:bg-ink-850', !grouped && 'mt-3')}
                >
                  {grouped ? (
                    <span className="w-8 shrink-0" />
                  ) : (
                    <Avatar
                      name={message.author?.full_name || message.author?.email || '?'}
                      src={message.author?.avatar_url}
                      size={32}
                      userId={message.author_id}
                      showPresence
                    />
                  )}
                  <div className="min-w-0 flex-1">
                    {!grouped && (
                      <div className="flex items-baseline gap-2">
                        <span className="text-sm font-semibold text-fg">
                          {message.author?.full_name || message.author?.email || 'Unknown'}
                        </span>
                        <span className="text-[11px] text-fg-muted">{formatDateTime(message.created_at)}</span>
                      </div>
                    )}
                    <p className="whitespace-pre-wrap text-sm leading-relaxed text-fg-secondary">
                      {renderMentions(message.body)}
                    </p>
                  </div>
                </div>
              )
            })}
            <div ref={bottomRef} />
          </div>
        )}
      </div>

      {/* ---- Typing + banner + composer ---- */}
      <div className="shrink-0 px-5 pb-4">
        <p className="h-5 px-1 text-xs italic text-fg-muted">
          {typingNames.length > 0 &&
            `${typingNames.slice(0, 2).join(', ')}${typingNames.length > 2 ? ' and others' : ''} ${typingNames.length === 1 ? 'is' : 'are'} typing…`}
        </p>

        {items.length === 0 && !bannerDismissed && !messages.isLoading && (
          <div className="mb-2 flex items-center gap-2.5 rounded-xl bg-[#f4f4f5] px-4 py-2.5">
            <span className="text-base">👋</span>
            <p className="flex-1 text-sm text-gray-800">
              <span className="font-bold">Send a message</span> to #{channelLabel} to get the
              conversation started!
            </p>
            <button
              onClick={dismissBanner}
              className="rounded-lg bg-white px-3 py-1.5 text-xs font-semibold text-gray-800 shadow-sm transition-colors hover:bg-gray-100"
            >
              Dismiss
            </button>
          </div>
        )}

        <div className="rounded-2xl border border-ink-600 bg-ink-800 px-3 pb-2 pt-1 transition-colors focus-within:border-brand">
          <MentionComposer
            ref={composerRef}
            channelId={channel.id}
            channelLabel={channelLabel}
            members={members.data ?? []}
            value={body}
            onChange={(v) => {
              setBody(v)
              onTyping()
            }}
            onMention={(name, userId) =>
              setMentionMap((prev) => {
                const next = new Map(prev)
                next.set(name, userId)
                return next
              })
            }
            onSubmit={() => body.trim() && send.mutate()}
          />
          <div className="mt-1 flex items-center gap-1">
            <button
              onClick={() => composerRef.current?.insertAt()}
              title="Mention someone"
              className="rounded-lg p-1.5 text-fg-muted transition-colors hover:bg-ink-750 hover:text-fg"
            >
              <AtSign size={16} />
            </button>
            <span className="flex-1" />
            <button
              className={cn(
                'flex h-8 w-8 items-center justify-center rounded-lg transition-colors',
                body.trim()
                  ? 'bg-brand text-white hover:bg-brand-hover'
                  : 'text-fg-muted cursor-not-allowed',
              )}
              disabled={!body.trim() || send.isPending}
              onClick={() => send.mutate()}
              title="Send"
            >
              <Send size={15} />
            </button>
          </div>
        </div>
      </div>

      <MembersModal
        open={membersOpen}
        onClose={() => setMembersOpen(false)}
        channel={channel}
        members={members.data ?? []}
      />
      <ChannelSettingsModal open={settingsOpen} onClose={() => setSettingsOpen(false)} channel={channel} />
    </div>
  )
}

/* ---------------- Composer with @mention autocomplete ---------------- */

interface ComposerHandle {
  insertAt: () => void
}

const MentionComposer = forwardRef<
  ComposerHandle,
  {
    channelId: string
    channelLabel: string
    members: ChannelMember[]
    value: string
    onChange: (v: string) => void
    onMention?: (name: string, userId: string) => void
    onSubmit: () => void
  }
>(function MentionComposer({ channelLabel, members, value, onChange, onMention, onSubmit }, ref) {
  const [mentionQuery, setMentionQuery] = useState<string | null>(null)
  const [highlightIndex, setHighlightIndex] = useState(0)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  useImperativeHandle(ref, () => ({
    insertAt: () => {
      const textarea = textareaRef.current
      if (!textarea) return
      const cursor = textarea.selectionStart
      const before = value.slice(0, cursor)
      const needsSpace = before.length > 0 && !/\s$/.test(before)
      const next = before + (needsSpace ? ' @' : '@') + value.slice(cursor)
      onChange(next)
      setMentionQuery('')
      setTimeout(() => {
        textarea.focus()
        const pos = before.length + (needsSpace ? 2 : 1)
        textarea.selectionStart = textarea.selectionEnd = pos
      }, 0)
    },
  }))

  const candidates =
    mentionQuery !== null
      ? members.filter((m) => {
          const name = (m.user?.full_name || m.user?.email || '').toLowerCase()
          return name.includes(mentionQuery.toLowerCase())
        })
      : []

  const detectMention = (text: string, cursor: number) => {
    const before = text.slice(0, cursor)
    const match = /(^|\s)@(\w*)$/.exec(before)
    setMentionQuery(match ? match[2] : null)
    setHighlightIndex(0)
  }

  const insertMention = (member: ChannelMember) => {
    const textarea = textareaRef.current
    if (!textarea || !member.user) return
    const cursor = textarea.selectionStart
    const before = value.slice(0, cursor)
    const after = value.slice(cursor)
    const name = member.user.full_name || member.user.email
    const replaced = before.replace(/(^|\s)@(\w*)$/, `$1@${name} `)
    onChange(replaced + after)
    onMention?.(name, member.user_id)
    setMentionQuery(null)
    setTimeout(() => {
      textarea.focus()
      textarea.selectionStart = textarea.selectionEnd = replaced.length
    }, 0)
  }

  return (
    <div className="relative">
      {mentionQuery !== null && candidates.length > 0 && (
        <div className="menu-panel absolute bottom-full left-0 z-30 mb-2 w-64">
          {candidates.slice(0, 6).map((member, i) => (
            <button
              key={member.user_id}
              className={cn('menu-item', i === highlightIndex && 'bg-ink-750 text-fg')}
              onMouseDown={(e) => {
                e.preventDefault()
                insertMention(member)
              }}
            >
              <Avatar
                name={member.user?.full_name || member.user?.email || '?'}
                src={member.user?.avatar_url}
                size={22}
              />
              <span className="flex-1 truncate">{member.user?.full_name || member.user?.email}</span>
            </button>
          ))}
        </div>
      )}
      <textarea
        ref={textareaRef}
        rows={1}
        value={value}
        onChange={(e) => {
          onChange(e.target.value)
          detectMention(e.target.value, e.target.selectionStart)
        }}
        onKeyDown={(e) => {
          if (mentionQuery !== null && candidates.length > 0) {
            if (e.key === 'ArrowDown') {
              e.preventDefault()
              setHighlightIndex((i) => Math.min(i + 1, Math.min(candidates.length, 6) - 1))
              return
            }
            if (e.key === 'ArrowUp') {
              e.preventDefault()
              setHighlightIndex((i) => Math.max(i - 1, 0))
              return
            }
            if (e.key === 'Enter' || e.key === 'Tab') {
              e.preventDefault()
              insertMention(candidates[highlightIndex])
              return
            }
            if (e.key === 'Escape') {
              setMentionQuery(null)
              return
            }
          }
          if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault()
            onSubmit()
          }
        }}
        placeholder={`Write to #${channelLabel}, use '@' to mention`}
        className="max-h-32 w-full resize-none bg-transparent px-1.5 py-2 text-sm text-fg outline-none placeholder:text-fg-muted"
      />
    </div>
  )
})

/* ---------------- Members modal (list + add people) ---------------- */

function MembersModal({
  open,
  onClose,
  channel,
  members,
}: {
  open: boolean
  onClose: () => void
  channel: Channel
  members: ChannelMember[]
}) {
  const queryClient = useQueryClient()
  const user = useAuthStore((s) => s.user)
  const { org, workspace } = useCurrentContext()
  const [selected, setSelected] = useState<string[]>([])
  const [busy, setBusy] = useState(false)

  const workspaceMembers = useQuery({
    queryKey: ['workspace-members', channel.workspace_id],
    queryFn: () => api.get<OrgMember[]>(`/workspaces/${channel.workspace_id}/members`),
    enabled: open,
  })

  const memberIds = new Set(members.map((m) => m.user_id))
  const addable = (workspaceMembers.data ?? []).filter((m) => !memberIds.has(m.user_id))
  const myRole = members.find((m) => m.user_id === user?.id)?.role
  const canManageMembers =
    myRole === 'admin' ||
    workspace?.my_role === 'admin' ||
    workspace?.my_role === 'owner' ||
    org?.my_role === 'owner'

  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: ['channel-members', channel.id] })
    void queryClient.invalidateQueries({ queryKey: ['channels'] })
  }

  const add = async () => {
    if (selected.length === 0) return
    setBusy(true)
    try {
      await api.post(`/channels/${channel.id}/members`, { user_ids: selected })
      toast.success(`${selected.length} member(s) added`)
      setSelected([])
      refresh()
    } catch (err) {
      toast.error(errorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  const remove = async (userId: string) => {
    try {
      await api.delete(`/channels/${channel.id}/members/${userId}`)
      refresh()
    } catch (err) {
      toast.error(errorMessage(err))
    }
  }

  return (
    <Modal open={open} onClose={onClose} title={`#${channel.name} — members`} width="max-w-md">
      <div className="space-y-4">
        <div className="max-h-60 space-y-0.5 overflow-y-auto">
          {members.map((member) => (
            <div key={member.id} className="group flex items-center gap-2.5 rounded-lg px-2 py-1.5 hover:bg-ink-800">
              <Avatar
                name={member.user?.full_name || member.user?.email || '?'}
                src={member.user?.avatar_url}
                size={26}
                userId={member.user_id}
                showPresence
              />
              <span className="flex-1 truncate text-sm text-fg">
                {member.user?.full_name || member.user?.email}
                {member.user_id === user?.id && <span className="text-fg-muted"> (you)</span>}
              </span>
              <span className="text-[10px] uppercase text-fg-muted">{member.role}</span>
              {(canManageMembers || member.user_id === user?.id) && (
                <button
                  className="hidden text-fg-muted hover:text-red-400 group-hover:block"
                  onClick={() => remove(member.user_id)}
                  title={member.user_id === user?.id ? 'Leave channel' : 'Remove'}
                >
                  <X size={13} />
                </button>
              )}
            </div>
          ))}
        </div>

        {canManageMembers && addable.length > 0 ? (
          <div className="border-t border-ink-700 pt-3">
            <p className="mb-2 flex items-center gap-1.5 text-xs font-semibold text-fg-secondary">
              <UserPlus size={13} /> Add people
            </p>
            <div className="max-h-40 space-y-0.5 overflow-y-auto">
              {addable.map((m) => (
                <label key={m.user_id} className="flex cursor-pointer items-center gap-2.5 rounded-lg px-2 py-1.5 hover:bg-ink-800">
                  <input
                    type="checkbox"
                    className="accent-brand"
                    checked={selected.includes(m.user_id)}
                    onChange={(e) =>
                      setSelected((prev) =>
                        e.target.checked ? [...prev, m.user_id] : prev.filter((id) => id !== m.user_id),
                      )
                    }
                  />
                  <Avatar name={m.user?.full_name || m.user?.email || '?'} src={m.user?.avatar_url} size={24} />
                  <span className="flex-1 truncate text-sm text-fg">{m.user?.full_name || m.user?.email}</span>
                </label>
              ))}
            </div>
            <button className="btn-primary mt-3 w-full" disabled={busy || selected.length === 0} onClick={add}>
              {busy ? 'Adding…' : `Add ${selected.length || ''} ${selected.length === 1 ? 'person' : 'people'}`}
            </button>
          </div>
        ) : (
          <p className="border-t border-ink-700 pt-3 text-xs text-fg-muted">
            Everyone in this workspace is already in the channel.
          </p>
        )}
      </div>
    </Modal>
  )
}

/* ---------------- Channel settings modal ---------------- */

function ChannelSettingsModal({
  open,
  onClose,
  channel,
}: {
  open: boolean
  onClose: () => void
  channel: Channel
}) {
  const queryClient = useQueryClient()
  const [params, setParams] = useSearchParams()
  const [name, setName] = useState(channel.name)
  const [description, setDescription] = useState(channel.description ?? '')
  const [busy, setBusy] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)

  const save = async () => {
    setBusy(true)
    try {
      await api.patch(`/channels/${channel.id}`, {
        name: name.trim() || channel.name,
        description: description.trim() || null,
      })
      toast.success('Channel updated')
      void queryClient.invalidateQueries({ queryKey: ['channels'] })
      onClose()
    } catch (err) {
      toast.error(errorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  const remove = async () => {
    setBusy(true)
    try {
      await api.delete(`/channels/${channel.id}`)
      toast.success('Channel deleted')
      void queryClient.invalidateQueries({ queryKey: ['channels'] })
      params.delete('channel')
      setParams(params, { replace: true })
      onClose()
    } catch (err) {
      toast.error(errorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal open={open} onClose={onClose} title="Channel settings" width="max-w-md">
      <div className="space-y-3">
        <div>
          <label className="mb-1.5 block text-xs font-medium text-fg-secondary">Name</label>
          <input className="input-dark" value={name} onChange={(e) => setName(e.target.value)} />
        </div>
        <div>
          <label className="mb-1.5 block text-xs font-medium text-fg-secondary">Description</label>
          <input
            className="input-dark"
            placeholder="What's this channel about?"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
          />
        </div>
        <button className="btn-primary w-full" disabled={busy || !name.trim()} onClick={save}>
          Save changes
        </button>
        <div className="border-t border-ink-700 pt-3">
          {confirmDelete ? (
            <div className="flex items-center justify-between gap-2 text-sm">
              <span className="text-fg-secondary">Delete #{channel.name} for everyone?</span>
              <button className="font-semibold text-red-400 hover:text-red-300" onClick={remove} disabled={busy}>
                Delete
              </button>
              <button className="text-fg-muted hover:text-fg" onClick={() => setConfirmDelete(false)}>
                Cancel
              </button>
            </div>
          ) : (
            <button
              className="flex items-center gap-1.5 text-xs text-fg-muted transition-colors hover:text-red-400"
              onClick={() => setConfirmDelete(true)}
            >
              <Trash2 size={13} /> Delete channel
            </button>
          )}
        </div>
      </div>
    </Modal>
  )
}

/* ---------------- Create channel modal ---------------- */

function CreateChannelModal({
  open,
  onClose,
  workspaceId,
  onCreated,
}: {
  open: boolean
  onClose: () => void
  workspaceId: string | undefined
  onCreated: (id: string) => void
}) {
  const queryClient = useQueryClient()
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [isPrivate, setIsPrivate] = useState(false)
  const [creating, setCreating] = useState(false)

  const create = async () => {
    if (!workspaceId || !name.trim()) return
    setCreating(true)
    try {
      const channel = await api.post<Channel>(`/workspaces/${workspaceId}/channels`, {
        name: name.trim(),
        description: description.trim() || null,
        is_private: isPrivate,
      })
      void queryClient.invalidateQueries({ queryKey: ['channels', workspaceId] })
      toast.success(`#${channel.name} created`)
      setName('')
      setDescription('')
      onClose()
      onCreated(channel.id)
    } catch (err) {
      toast.error(errorMessage(err))
    } finally {
      setCreating(false)
    }
  }

  return (
    <Modal open={open} onClose={onClose} title="Create channel" width="max-w-md">
      <div className="space-y-3">
        <div>
          <label className="mb-1.5 block text-xs font-medium text-fg-secondary">Name</label>
          <input
            className="input-dark"
            placeholder="e.g. engineering"
            value={name}
            onChange={(e) => setName(e.target.value)}
            autoFocus
          />
        </div>
        <div>
          <label className="mb-1.5 block text-xs font-medium text-fg-secondary">Description (optional)</label>
          <input
            className="input-dark"
            placeholder="What's this channel about?"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
          />
        </div>
        <label className="flex cursor-pointer items-center gap-2 text-sm text-fg-secondary">
          <input
            type="checkbox"
            checked={isPrivate}
            onChange={(e) => setIsPrivate(e.target.checked)}
            className="accent-brand"
          />
          Private channel (invite only)
        </label>
        <button className="btn-primary w-full" disabled={creating || !name.trim()} onClick={create}>
          {creating ? 'Creating…' : 'Create channel'}
        </button>
      </div>
    </Modal>
  )
}
