import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  AtSign,
  CheckSquare,
  Hash,
  Lock,
  MessageCircle,
  MoreHorizontal,
  Paperclip,
  Pencil,
  Plus,
  Search,
  Send,
  Settings,
  Smile,
  Trash2,
  UserPlus,
  Users,
  X,
} from 'lucide-react'
import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'

import { api, errorMessage } from '../../lib/api'
import { canCreateChannel } from '../../lib/chatAccess'
import { useChannels, useCurrentContext } from '../../lib/queries'
import { useQueryFlagModal } from '../../lib/useQueryFlagModal'
import type { Channel, ChatAttachment, ChatMessage, OrgMember, Page, Task } from '../../lib/types'
import { cn, formatBytes, formatDateTime, TASK_MARKUP_RE, toMentionMarkup, toPlainBody } from '../../lib/utils'
import { realtime, useRealtime } from '../../lib/ws'
import { useAuthStore } from '../../stores/auth'
import { toast } from '../../stores/toast'
import { useUIStore } from '../../stores/ui'
import { CreateChannelModal } from '../../components/chat/CreateChannelModal'
import { EmojiPicker } from '../../components/chat/EmojiPicker'
import { MessageAttachments } from '../../components/chat/ChatAttachments'
import { MessageBody } from '../../components/chat/MessageBody'
import { TaskBrowsePanel } from '../../components/chat/TaskBrowsePanel'
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
  const { isOpen: createOpen, open: openCreate, close: closeCreate } = useQueryFlagModal()
  const canManage = canCreateChannel(org, workspace)

  const channelId = params.get('channel') ?? channels.data?.[0]?.id ?? null
  const channel = channels.data?.find((c) => c.id === channelId) ?? null

  const selectChannel = (id: string) => {
    params.set('channel', id)
    params.delete('new')
    setParams(params, { replace: true })
  }

  useRealtime(
    ['chat.message.created', 'channel.created', 'channel.updated', 'channel.deleted', 'channel.members.updated'],
    () => {
      void queryClient.invalidateQueries({ queryKey: ['channels', workspace?.id] })
    },
    [workspace?.id],
  )

  return (
    <div className="flex h-full">
      {/* Channel list */}
      <div className="flex w-60 shrink-0 flex-col border-r border-ink-700 bg-ink-850/50">
        <div className="flex items-center justify-between px-4 py-3.5">
          <h2 className="text-sm font-bold text-fg">Chat</h2>
          {canManage && (
            <button className="btn-ghost !p-1.5" onClick={openCreate} title="New channel">
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
                <button className="btn-primary" onClick={openCreate}>
                  <Plus size={14} /> New channel
                </button>
              ) : undefined
            }
          />
        </div>
      )}

      <CreateChannelModal
        open={createOpen && canManage}
        onClose={closeCreate}
        workspaceId={workspace?.id}
        onCreated={(id) => selectChannel(id)}
      />
    </div>
  )
}

function Conversation({ channel }: { channel: Channel }) {
  const queryClient = useQueryClient()
  const user = useAuthStore((s) => s.user)
  const { org, workspace } = useCurrentContext()
  // Only workspace admins / org leaders may change or delete the general channel.
  const canManageChannel = canCreateChannel(org, workspace)
  const canOpenSettings = !channel.is_general || canManageChannel
  const setSearchOpen = useUIStore((s) => s.setSearchOpen)
  const [body, setBody] = useState('')
  const [mentionMap, setMentionMap] = useState<Map<string, string>>(new Map())
  const [taskMap, setTaskMap] = useState<Map<string, string>>(new Map())
  const [pendingFiles, setPendingFiles] = useState<ChatAttachment[]>([])
  const [uploading, setUploading] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editText, setEditText] = useState('')
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [typingUsers, setTypingUsers] = useState<Map<string, number>>(new Map())
  const [bannerDismissed, setBannerDismissed] = useState(
    () => localStorage.getItem(`flowdesk-chat-banner-${channel.id}`) === '1',
  )
  const [membersOpen, setMembersOpen] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const bottomRef = useRef<HTMLDivElement>(null)
  const listRef = useRef<HTMLDivElement>(null)
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

  useEffect(() => {
    realtime.send({ type: 'subscribe.channel', channel_id: channel.id })
  }, [channel.id])

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
    'channel.members.updated',
    (event) => {
      if (event.payload.channel_id === channel.id) {
        void queryClient.invalidateQueries({ queryKey: ['channel-members', channel.id] })
        void queryClient.invalidateQueries({ queryKey: ['channels'] })
      }
    },
    [channel.id],
  )

  useRealtime(
    ['chat.message.updated', 'chat.message.deleted'],
    (event) => {
      if (event.payload.channel_id === channel.id) {
        void queryClient.invalidateQueries({ queryKey: ['messages', channel.id] })
      }
    },
    [channel.id],
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
    // Scroll the message list itself — never `bottomRef.scrollIntoView`, which
    // also scrolls ancestor scroll containers (and the viewport) and was pushing
    // the app's top bar off-screen until a reload during SPA navigation.
    const el = listRef.current
    if (el) el.scrollTop = el.scrollHeight
    const items = messages.data?.items
    if (items?.length) {
      const last = items[items.length - 1]
      void api.post(`/channels/${channel.id}/read`, { message_id: last.id }).then(() => {
        void queryClient.invalidateQueries({ queryKey: ['channels'] })
      })
    }
  }, [messages.data?.items.length, channel.id])

  /** Serialize task refs `#REF` → `#[REF](task-id)` using the map collected from the picker. */
  const serializeTaskRefs = (text: string, refs: Map<string, string>): string => {
    if (refs.size === 0) return text
    let out = text
    for (const [ref, id] of [...refs.entries()].sort((a, b) => b[0].length - a[0].length)) {
      const escaped = ref.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
      out = out.replace(new RegExp(`#${escaped}(?!\\w)`, 'g'), `#[${ref}](${id})`)
    }
    return out
  }

  const serializeOutgoing = (text: string): string =>
    serializeTaskRefs(toMentionMarkup(text, mentionMap), taskMap)

  const send = useMutation({
    mutationFn: (clientMessageId: string) =>
      api.post<ChatMessage>(`/channels/${channel.id}/messages`, {
        body: serializeOutgoing(body.trim()),
        client_message_id: clientMessageId,
        attachment_ids: pendingFiles.map((f) => f.id),
      }),
    onSuccess: () => {
      setBody('')
      setMentionMap(new Map())
      setTaskMap(new Map())
      setPendingFiles([])
      void queryClient.invalidateQueries({ queryKey: ['messages', channel.id] })
    },
    onError: (err) => toast.error(errorMessage(err)),
  })

  const pendingClientId = useRef<string | null>(null)
  const canSend = (body.trim().length > 0 || pendingFiles.length > 0) && !uploading

  const submitMessage = () => {
    if (!canSend || send.isPending) return
    if (!pendingClientId.current) {
      pendingClientId.current = crypto.randomUUID()
    }
    send.mutate(pendingClientId.current, {
      onSuccess: () => {
        pendingClientId.current = null
      },
    })
  }

  const uploadFiles = async (files: FileList | null) => {
    if (!files || files.length === 0) return
    setUploading(true)
    try {
      for (const file of Array.from(files).slice(0, 10 - pendingFiles.length)) {
        const form = new FormData()
        form.append('file', file)
        const uploaded = await api.upload<ChatAttachment>(`/channels/${channel.id}/attachments`, form)
        setPendingFiles((prev) => [...prev, uploaded])
      }
    } catch (err) {
      toast.error(errorMessage(err))
    } finally {
      setUploading(false)
      if (fileInputRef.current) fileInputRef.current.value = ''
    }
  }

  const removePendingFile = async (attachment: ChatAttachment) => {
    setPendingFiles((prev) => prev.filter((f) => f.id !== attachment.id))
    try {
      await api.delete(`/chat-attachments/${attachment.id}`)
    } catch {
      /* already gone — harmless */
    }
  }

  /** Re-link markup when saving an edit: names/refs come from the original
   *  message's markup plus current channel members. */
  const reSerializeEdited = (plain: string, original: string): string => {
    const names = new Map<string, string>()
    for (const m of original.matchAll(/@\[([^\]]+)\]\(([0-9a-fA-F-]{36}|all)\)/g)) {
      names.set(m[1], m[2])
    }
    for (const member of members.data ?? []) {
      const name = member.user?.full_name || member.user?.email
      if (name && !names.has(name)) names.set(name, member.user_id)
    }
    const refs = new Map<string, string>()
    for (const m of original.matchAll(new RegExp(TASK_MARKUP_RE.source, 'g'))) {
      refs.set(m[1], m[2])
    }
    return serializeTaskRefs(toMentionMarkup(plain, names), refs)
  }

  const startEdit = (message: ChatMessage) => {
    setEditingId(message.id)
    setEditText(toPlainBody(message.body))
    setConfirmDeleteId(null)
  }

  const saveEdit = async (message: ChatMessage) => {
    const text = editText.trim()
    if (!text) return
    try {
      await api.patch(`/channels/${channel.id}/messages/${message.id}`, {
        body: reSerializeEdited(text, message.body),
      })
      setEditingId(null)
      void queryClient.invalidateQueries({ queryKey: ['messages', channel.id] })
    } catch (err) {
      toast.error(errorMessage(err))
    }
  }

  const deleteMessage = async (messageId: string) => {
    if (confirmDeleteId !== messageId) {
      setConfirmDeleteId(messageId)
      window.setTimeout(() => setConfirmDeleteId((id) => (id === messageId ? null : id)), 3000)
      return
    }
    setConfirmDeleteId(null)
    try {
      await api.delete(`/channels/${channel.id}/messages/${messageId}`)
      void queryClient.invalidateQueries({ queryKey: ['messages', channel.id] })
    } catch (err) {
      toast.error(errorMessage(err))
    }
  }

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
                {canOpenSettings && (
                  <button
                    className="menu-item"
                    onClick={() => {
                      close()
                      setSettingsOpen(true)
                    }}
                  >
                    <Settings size={14} /> Settings
                  </button>
                )}
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
                {canOpenSettings && (
                  <button
                    className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left text-sm font-medium text-fg transition-colors hover:bg-ink-750"
                    onClick={() => {
                      close()
                      setSettingsOpen(true)
                    }}
                  >
                    <Settings size={16} className="text-fg-secondary" /> Settings
                  </button>
                )}
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
      <div ref={listRef} className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
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
              const isOwn = message.author_id === user?.id
              const isEditing = editingId === message.id
              return (
                <div
                  key={message.id}
                  className={cn('group relative flex gap-3 rounded-lg px-2 py-0.5 hover:bg-ink-850', !grouped && 'mt-3')}
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
                    {isEditing ? (
                      <div className="mt-0.5">
                        <textarea
                          autoFocus
                          rows={2}
                          value={editText}
                          onChange={(e) => setEditText(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter' && !e.shiftKey) {
                              e.preventDefault()
                              void saveEdit(message)
                            }
                            if (e.key === 'Escape') setEditingId(null)
                          }}
                          className="w-full resize-none rounded-lg border border-brand bg-ink-800 px-2.5 py-1.5 text-sm text-fg outline-none"
                        />
                        <p className="mt-0.5 text-[10px] text-fg-muted">
                          Enter to save · Esc to cancel
                        </p>
                      </div>
                    ) : (
                      <>
                        {message.body.trim().length > 0 && (
                          <p className="whitespace-pre-wrap text-sm leading-relaxed text-fg-secondary">
                            <MessageBody body={message.body} currentUserId={user?.id} />
                            {message.edited_at && (
                              <span className="ml-1.5 text-[10px] text-fg-muted">(edited)</span>
                            )}
                          </p>
                        )}
                        <MessageAttachments attachments={message.attachments ?? []} />
                      </>
                    )}
                  </div>

                  {isOwn && !isEditing && (
                    <div className="absolute -top-2.5 right-2 hidden items-center gap-0.5 rounded-lg border border-ink-700 bg-ink-850 p-0.5 shadow-sm group-hover:flex">
                      <button
                        type="button"
                        title="Edit message"
                        onClick={() => startEdit(message)}
                        className="rounded-md p-1 text-fg-muted transition-colors hover:bg-ink-750 hover:text-fg"
                      >
                        <Pencil size={12} />
                      </button>
                      <button
                        type="button"
                        title={confirmDeleteId === message.id ? 'Click again to delete' : 'Delete message'}
                        onClick={() => void deleteMessage(message.id)}
                        className={cn(
                          'rounded-md p-1 transition-colors',
                          confirmDeleteId === message.id
                            ? 'bg-red-500/15 text-red-400'
                            : 'text-fg-muted hover:bg-ink-750 hover:text-red-400',
                        )}
                      >
                        <Trash2 size={12} />
                      </button>
                    </div>
                  )}
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
          {(pendingFiles.length > 0 || uploading) && (
            <div className="flex flex-wrap gap-1.5 px-1 pt-1.5">
              {pendingFiles.map((file) => (
                <span
                  key={file.id}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-ink-600 bg-ink-750 py-1 pl-2 pr-1 text-xs text-fg"
                >
                  <Paperclip size={11} className="shrink-0 text-fg-muted" />
                  <span className="max-w-[160px] truncate">{file.file_name}</span>
                  <span className="text-[10px] text-fg-muted">{formatBytes(file.size_bytes)}</span>
                  <button
                    type="button"
                    title="Remove file"
                    onClick={() => void removePendingFile(file)}
                    className="rounded p-0.5 text-fg-muted transition-colors hover:bg-ink-700 hover:text-red-400"
                  >
                    <X size={11} />
                  </button>
                </span>
              ))}
              {uploading && <span className="py-1 text-[11px] italic text-fg-muted">Uploading…</span>}
            </div>
          )}
          <MentionComposer
            ref={composerRef}
            channelId={channel.id}
            channelLabel={channelLabel}
            workspaceId={channel.workspace_id}
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
            onTaskMention={(ref, taskId) =>
              setTaskMap((prev) => {
                const next = new Map(prev)
                next.set(ref, taskId)
                return next
              })
            }
            onSubmit={() => submitMessage()}
          />
          <div className="mt-1 flex items-center gap-1">
            <button
              onClick={() => composerRef.current?.insertAt()}
              title="Mention someone (@) · link a task (@@)"
              className="rounded-lg p-1.5 text-fg-muted transition-colors hover:bg-ink-750 hover:text-fg"
            >
              <AtSign size={16} />
            </button>
            <button
              onClick={() => fileInputRef.current?.click()}
              title="Attach files"
              className="rounded-lg p-1.5 text-fg-muted transition-colors hover:bg-ink-750 hover:text-fg"
            >
              <Paperclip size={16} />
            </button>
            <input
              ref={fileInputRef}
              type="file"
              multiple
              className="hidden"
              aria-label="Attach files"
              onChange={(e) => void uploadFiles(e.target.files)}
            />
            <Dropdown
              width="w-auto"
              trigger={
                <button
                  title="Emoji"
                  className="rounded-lg p-1.5 text-fg-muted transition-colors hover:bg-ink-750 hover:text-fg"
                >
                  <Smile size={16} />
                </button>
              }
            >
              {(close) => (
                <div className="p-2">
                  <EmojiPicker
                    onPick={(emoji) => {
                      composerRef.current?.insertText(emoji)
                      close()
                    }}
                  />
                </div>
              )}
            </Dropdown>
            <span className="flex-1" />
            <button
              className={cn(
                'flex h-8 w-8 items-center justify-center rounded-lg transition-colors',
                canSend ? 'bg-brand text-white hover:bg-brand-hover' : 'text-fg-muted cursor-not-allowed',
              )}
              disabled={!canSend || send.isPending}
              onClick={() => submitMessage()}
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
  insertText: (text: string) => void
}

const MentionComposer = forwardRef<
  ComposerHandle,
  {
    channelId: string
    channelLabel: string
    workspaceId: string
    members: ChannelMember[]
    value: string
    onChange: (v: string) => void
    onMention?: (name: string, userId: string) => void
    onTaskMention?: (ref: string, taskId: string) => void
    onSubmit: () => void
  }
>(function MentionComposer(
  { channelLabel, workspaceId, members, value, onChange, onMention, onTaskMention, onSubmit },
  ref,
) {
  const [mentionQuery, setMentionQuery] = useState<string | null>(null)
  const [taskQuery, setTaskQuery] = useState<string | null>(null)
  // The task picker has two modes: free-text search (default) and a ClickUp-style
  // Space → Project → List drill-down.
  const [taskMode, setTaskMode] = useState<'search' | 'browse'>('search')
  const [highlightIndex, setHighlightIndex] = useState(0)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const optionRefs = useRef<(HTMLButtonElement | null)[]>([])

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
    insertText: (text: string) => {
      const textarea = textareaRef.current
      if (!textarea) {
        onChange(value + text)
        return
      }
      const cursor = textarea.selectionStart
      onChange(value.slice(0, cursor) + text + value.slice(cursor))
      setTimeout(() => {
        textarea.focus()
        textarea.selectionStart = textarea.selectionEnd = cursor + text.length
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

  // "@@" opens the task picker. Before the user types 2 chars (the search API
  // minimum) it suggests their own open tasks, so nobody has to remember names.
  const searchingTasks = taskQuery !== null && taskQuery.trim().length >= 2
  const taskResults = useQuery({
    queryKey: ['chat-task-search', taskQuery],
    queryFn: () =>
      api.get<{ tasks: Task[] }>(`/search?q=${encodeURIComponent(taskQuery ?? '')}&limit=6`),
    enabled: searchingTasks,
    staleTime: 15_000,
  })
  const myTasks = useQuery({
    queryKey: ['chat-my-tasks'],
    queryFn: () => api.get<Page<Task>>('/me/tasks?page_size=8'),
    enabled: taskQuery !== null,
    staleTime: 30_000,
  })
  const taskCandidates =
    taskQuery === null
      ? []
      : searchingTasks
        ? (taskResults.data?.tasks ?? [])
        : (myTasks.data?.items ?? []).filter((t) =>
            t.title.toLowerCase().includes(taskQuery.trim().toLowerCase()),
          )

  const detectMention = (text: string, cursor: number) => {
    const before = text.slice(0, cursor)
    const taskMatch = /(^|\s)@@([^\s@]*)$/.exec(before)
    if (taskMatch) {
      if (taskQuery === null) setTaskMode('search') // fresh open resets the mode
      setTaskQuery(taskMatch[2])
      setMentionQuery(null)
      setHighlightIndex(0)
      return
    }
    setTaskQuery(null)
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

  const insertTask = (task: Task) => {
    const textarea = textareaRef.current
    if (!textarea) return
    // Humans read task names, not refs — the label is the title (sanitized so it
    // can't break the #[label](id) markup), falling back to the ref if empty.
    const label = task.title.replace(/[[\]()]/g, '').trim().slice(0, 80) || task.ref
    const cursor = textarea.selectionStart
    const before = value.slice(0, cursor)
    const after = value.slice(cursor)
    const replaced = before.replace(/(^|\s)@@([^\s@]*)$/, `$1#${label} `)
    onChange(replaced + after)
    onTaskMention?.(label, task.id)
    setTaskQuery(null)
    setTimeout(() => {
      textarea.focus()
      textarea.selectionStart = textarea.selectionEnd = replaced.length
    }, 0)
  }

  // "@All" notifies everyone in the channel. Show it at the top of the list
  // when the query is empty or matches "all"/"everyone".
  const showAll =
    mentionQuery !== null &&
    (mentionQuery === '' ||
      'all'.startsWith(mentionQuery.toLowerCase()) ||
      'everyone'.startsWith(mentionQuery.toLowerCase()))
  type MentionOption =
    | { kind: 'all' }
    | { kind: 'member'; member: ChannelMember }
    | { kind: 'task'; task: Task }
  const options: MentionOption[] =
    taskQuery !== null
      ? taskCandidates.map((task) => ({ kind: 'task', task }) as MentionOption)
      : [
          ...(showAll ? [{ kind: 'all' } as MentionOption] : []),
          ...candidates.map((member) => ({ kind: 'member', member }) as MentionOption),
        ]
  const pickerOpen = mentionQuery !== null || taskQuery !== null

  useEffect(() => {
    optionRefs.current[highlightIndex]?.scrollIntoView({ block: 'nearest' })
  }, [highlightIndex, options.length])

  const insertAll = () => {
    const textarea = textareaRef.current
    if (!textarea) return
    const cursor = textarea.selectionStart
    const before = value.slice(0, cursor)
    const after = value.slice(cursor)
    const replaced = before.replace(/(^|\s)@(\w*)$/, `$1@All `)
    onChange(replaced + after)
    onMention?.('All', 'all')
    setMentionQuery(null)
    setTimeout(() => {
      textarea.focus()
      textarea.selectionStart = textarea.selectionEnd = replaced.length
    }, 0)
  }
  const selectOption = (opt: MentionOption) =>
    opt.kind === 'all' ? insertAll() : opt.kind === 'task' ? insertTask(opt.task) : insertMention(opt.member)

  return (
    <div className="relative">
      {pickerOpen && (options.length > 0 || taskQuery !== null) && (
        <div
          className={cn(
            'menu-panel absolute bottom-full left-0 z-30 mb-2 overflow-y-auto overscroll-contain',
            taskQuery !== null && taskMode === 'browse' ? 'max-h-80 w-80' : 'max-h-60 w-72',
          )}
        >
          {taskQuery !== null && (
            <div className="flex items-center gap-1 border-b border-ink-700 px-2 py-1.5">
              {(['search', 'browse'] as const).map((mode) => (
                <button
                  key={mode}
                  type="button"
                  onMouseDown={(e) => {
                    e.preventDefault()
                    setTaskMode(mode)
                  }}
                  className={cn(
                    'rounded-md px-2 py-0.5 text-[11px] font-medium capitalize transition-colors',
                    taskMode === mode ? 'bg-brand/15 text-brand' : 'text-fg-secondary hover:bg-ink-750 hover:text-fg',
                  )}
                >
                  {mode === 'search' ? 'Search' : 'Browse'}
                </button>
              ))}
            </div>
          )}
          {taskQuery !== null && taskMode === 'browse' && (
            <TaskBrowsePanel workspaceId={workspaceId} onPick={insertTask} />
          )}
          {taskQuery !== null && taskMode === 'search' && !searchingTasks && (
            <p className="px-3 pb-1 pt-2 text-[10px] font-semibold uppercase tracking-wider text-fg-muted">
              Your open tasks · type to search all
            </p>
          )}
          {taskQuery !== null && taskMode === 'search' && options.length === 0 && (
            <p className="px-3 py-2 text-xs text-fg-muted">
              {!searchingTasks
                ? myTasks.isLoading
                  ? 'Loading your tasks…'
                  : 'No open tasks assigned to you — type to search all tasks.'
                : taskResults.isLoading
                  ? 'Searching tasks…'
                  : 'No matching tasks.'}
            </p>
          )}
          {!(taskQuery !== null && taskMode === 'browse') &&
            options.map((opt, i) =>
            opt.kind === 'all' ? (
              <button
                key="__all__"
                ref={(el) => {
                  optionRefs.current[i] = el
                }}
                className={cn('menu-item', i === highlightIndex && 'bg-ink-750 text-fg')}
                onMouseDown={(e) => {
                  e.preventDefault()
                  insertAll()
                }}
              >
                <span className="flex h-[22px] w-[22px] shrink-0 items-center justify-center rounded-full bg-brand/20 text-[11px] font-bold text-brand">
                  @
                </span>
                <span className="flex-1 truncate">
                  All <span className="text-fg-muted">· notify everyone</span>
                </span>
              </button>
            ) : opt.kind === 'task' ? (
              <button
                key={opt.task.id}
                ref={(el) => {
                  optionRefs.current[i] = el
                }}
                className={cn('menu-item', i === highlightIndex && 'bg-ink-750 text-fg')}
                onMouseDown={(e) => {
                  e.preventDefault()
                  insertTask(opt.task)
                }}
              >
                <CheckSquare size={15} className="shrink-0 text-brand" />
                <span className="flex-1 truncate">{opt.task.title}</span>
                {opt.task.status && (
                  <span
                    className="shrink-0 rounded px-1.5 py-px text-[9px] font-semibold uppercase"
                    style={{ color: opt.task.status.color, backgroundColor: `${opt.task.status.color}1a` }}
                  >
                    {opt.task.status.name}
                  </span>
                )}
              </button>
            ) : (
              <button
                key={opt.member.user_id}
                ref={(el) => {
                  optionRefs.current[i] = el
                }}
                className={cn('menu-item', i === highlightIndex && 'bg-ink-750 text-fg')}
                onMouseDown={(e) => {
                  e.preventDefault()
                  insertMention(opt.member)
                }}
              >
                <Avatar
                  name={opt.member.user?.full_name || opt.member.user?.email || '?'}
                  src={opt.member.user?.avatar_url}
                  size={22}
                />
                <span className="flex-1 truncate">{opt.member.user?.full_name || opt.member.user?.email}</span>
              </button>
            ),
          )}
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
          const browsing = taskQuery !== null && taskMode === 'browse'
          if (browsing && e.key === 'Enter') {
            // Don't send the half-typed "@@" while drilling through the browser.
            e.preventDefault()
            return
          }
          if (pickerOpen && options.length > 0 && !browsing) {
            if (e.key === 'ArrowDown') {
              e.preventDefault()
              setHighlightIndex((i) => Math.min(i + 1, options.length - 1))
              return
            }
            if (e.key === 'ArrowUp') {
              e.preventDefault()
              setHighlightIndex((i) => Math.max(i - 1, 0))
              return
            }
            if (e.key === 'Enter' || e.key === 'Tab') {
              e.preventDefault()
              const opt = options[highlightIndex] ?? options[0]
              if (opt) selectOption(opt)
              return
            }
          }
          if (pickerOpen && e.key === 'Escape') {
            setMentionQuery(null)
            setTaskQuery(null)
            return
          }
          if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault()
            onSubmit()
          }
        }}
        placeholder={`Write to #${channelLabel} — '@' to mention, '@@' to link a task`}
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
    (org?.my_role === 'owner' || org?.my_role === 'admin')

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
