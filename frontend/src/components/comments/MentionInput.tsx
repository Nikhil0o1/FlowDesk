import { useQuery } from '@tanstack/react-query'
import { useRef, useState } from 'react'

import { api } from '../../lib/api'
import type { OrgMember } from '../../lib/types'
import { Avatar } from '../ui/Avatar'

interface MentionInputProps {
  projectId: string
  value: string
  onChange: (value: string) => void
  onSubmit: () => void
  placeholder?: string
  autoFocus?: boolean
}

/**
 * Textarea with @mention autocomplete. Inserts `@[Name](uuid)` markup that the
 * backend parses into mention records + notifications.
 */
export function MentionInput({
  projectId,
  value,
  onChange,
  onSubmit,
  placeholder,
  autoFocus,
}: MentionInputProps) {
  const [mentionQuery, setMentionQuery] = useState<string | null>(null)
  const [highlightIndex, setHighlightIndex] = useState(0)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  const members = useQuery({
    queryKey: ['project-members', projectId],
    queryFn: () => api.get<OrgMember[]>(`/projects/${projectId}/members`),
    enabled: mentionQuery !== null,
  })

  const candidates =
    mentionQuery !== null
      ? (members.data ?? []).filter((m) => {
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

  const insertMention = (member: OrgMember) => {
    const textarea = textareaRef.current
    if (!textarea || !member.user) return
    const cursor = textarea.selectionStart
    const before = value.slice(0, cursor)
    const after = value.slice(cursor)
    const replaced = before.replace(/(^|\s)@(\w*)$/, `$1@[${member.user.full_name || member.user.email}](${member.user_id}) `)
    onChange(replaced + after)
    setMentionQuery(null)
    setTimeout(() => {
      textarea.focus()
      textarea.selectionStart = textarea.selectionEnd = replaced.length
    }, 0)
  }

  return (
    <div className="relative">
      {mentionQuery !== null && candidates.length > 0 && (
        <div className="menu-panel absolute bottom-full left-0 z-30 mb-1.5 w-64">
          {candidates.slice(0, 6).map((member, i) => (
            <button
              key={member.user_id}
              className={`menu-item ${i === highlightIndex ? 'bg-ink-750 text-fg' : ''}`}
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
        rows={2}
        autoFocus={autoFocus}
        value={value}
        placeholder={placeholder ?? 'Write a comment… use @ to mention'}
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
        className="input-dark resize-none"
      />
    </div>
  )
}
