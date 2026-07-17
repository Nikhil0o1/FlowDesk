import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'

import type { OrgMember } from '../../../../lib/types'
import { Avatar } from '../../../../components/ui/Avatar'

interface DocMentionInputProps {
  candidates: OrgMember[]
  value: string
  onChange: (value: string) => void
  onSubmit: () => void
  onMention?: (name: string, userId: string) => void
  placeholder?: string
  compact?: boolean
  disabled?: boolean
}

/** Workspace-scoped @mention textarea for doc comments (mirrors task MentionInput). */
export function DocMentionInput({
  candidates,
  value,
  onChange,
  onSubmit,
  onMention,
  placeholder,
  compact,
  disabled,
}: DocMentionInputProps) {
  const [mentionQuery, setMentionQuery] = useState<string | null>(null)
  const [highlightIndex, setHighlightIndex] = useState(0)
  const [dropdownPos, setDropdownPos] = useState<{ top: number; left: number; width: number } | null>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  const filtered =
    mentionQuery !== null
      ? candidates.filter((m) => {
          const name = (m.user?.full_name || m.user?.email || '').toLowerCase()
          return name.includes(mentionQuery.toLowerCase())
        })
      : []

  const updateDropdownPosition = () => {
    const textarea = textareaRef.current
    if (!textarea) return
    const rect = textarea.getBoundingClientRect()
    const width = Math.max(rect.width, 256)
    const left = Math.max(12, Math.min(rect.left, window.innerWidth - width - 12))
    setDropdownPos({ top: Math.max(12, rect.top - 8), left, width })
  }

  const detectMention = (text: string, cursor: number) => {
    const before = text.slice(0, cursor)
    const match = /(^|\s)@([^\s@]*)$/.exec(before)
    setMentionQuery(match ? match[2] : null)
    setHighlightIndex(0)
  }

  useEffect(() => {
    if (mentionQuery === null || filtered.length === 0) {
      setDropdownPos(null)
      return
    }
    updateDropdownPosition()
    const onLayout = () => updateDropdownPosition()
    window.addEventListener('scroll', onLayout, true)
    window.addEventListener('resize', onLayout)
    return () => {
      window.removeEventListener('scroll', onLayout, true)
      window.removeEventListener('resize', onLayout)
    }
  }, [mentionQuery, filtered.length, value])

  const insertMention = (member: OrgMember) => {
    const textarea = textareaRef.current
    if (!textarea || !member.user) return
    const cursor = textarea.selectionStart
    const before = value.slice(0, cursor)
    const after = value.slice(cursor)
    const name = member.user.full_name || member.user.email
    const replaced = before.replace(/(^|\s)@([^\s@]*)$/, `$1@${name} `)
    onChange(replaced + after)
    onMention?.(name, member.user_id)
    setMentionQuery(null)
    setDropdownPos(null)
    setTimeout(() => {
      textarea.focus()
      textarea.selectionStart = textarea.selectionEnd = replaced.length
    }, 0)
  }

  const showDropdown = mentionQuery !== null && filtered.length > 0 && dropdownPos

  return (
    <div className="relative">
      {showDropdown &&
        createPortal(
          <div
            className="menu-panel fixed z-[220] max-h-48 overflow-y-auto py-1"
            style={{ top: dropdownPos.top, left: dropdownPos.left, width: dropdownPos.width, transform: 'translateY(-100%)' }}
          >
            {filtered.map((member, i) => (
              <button
                key={member.user_id}
                type="button"
                className={`menu-item ${i === highlightIndex ? 'bg-ink-750 text-fg' : ''}`}
                onMouseDown={(e) => {
                  e.preventDefault()
                  insertMention(member)
                }}
              >
                <Avatar name={member.user?.full_name || member.user?.email || '?'} src={member.user?.avatar_url} size={22} />
                <span className="flex-1 truncate">{member.user?.full_name || member.user?.email}</span>
              </button>
            ))}
          </div>,
          document.body,
        )}
      <textarea
        ref={textareaRef}
        rows={compact ? 2 : 3}
        disabled={disabled}
        value={value}
        placeholder={placeholder ?? 'Write a comment… use @ to mention'}
        onChange={(e) => {
          onChange(e.target.value)
          detectMention(e.target.value, e.target.selectionStart)
        }}
        onKeyDown={(e) => {
          if (mentionQuery !== null && filtered.length > 0) {
            if (e.key === 'ArrowDown') {
              e.preventDefault()
              setHighlightIndex((i) => Math.min(i + 1, filtered.length - 1))
              return
            }
            if (e.key === 'ArrowUp') {
              e.preventDefault()
              setHighlightIndex((i) => Math.max(i - 1, 0))
              return
            }
            if (e.key === 'Enter' || e.key === 'Tab') {
              e.preventDefault()
              insertMention(filtered[highlightIndex])
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
        className={compact ? 'input-dark resize-none !py-1.5 text-xs' : 'input-dark resize-none text-sm'}
        aria-label="Comment"
      />
    </div>
  )
}
