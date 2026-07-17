import { CheckSquare } from 'lucide-react'
import { Link } from 'react-router-dom'

import { cn } from '../../lib/utils'

/**
 * Rich chat message body: renders mention markup `@[Name](uuid|all)` as
 * highlighted chips (stronger when it mentions YOU), task markup `#[REF](uuid)`
 * as task links, and bare URLs as clickable links. Everything else is plain text.
 */

const TOKEN_RE =
  /@\[([^\]]+)\]\(([0-9a-fA-F-]{36}|all)\)|#\[([^\]]+)\]\(([0-9a-fA-F-]{36})\)|(https?:\/\/[^\s<>"']+)/g

export function MessageBody({
  body,
  currentUserId,
}: {
  body: string
  currentUserId: string | undefined
}) {
  const parts: React.ReactNode[] = []
  let lastIndex = 0
  let match: RegExpExecArray | null
  const re = new RegExp(TOKEN_RE.source, 'g')

  while ((match = re.exec(body)) !== null) {
    if (match.index > lastIndex) {
      parts.push(body.slice(lastIndex, match.index))
    }
    const [, mentionName, mentionId, taskRef, taskId, url] = match
    if (mentionName !== undefined) {
      const mentionsMe = mentionId === 'all' || mentionId === currentUserId
      parts.push(
        <span
          key={`m-${match.index}`}
          className={cn(
            'mx-px rounded px-1 py-px font-medium',
            mentionsMe ? 'bg-brand text-white' : 'bg-brand-soft text-brand',
          )}
        >
          @{mentionName}
        </span>,
      )
    } else if (taskRef !== undefined) {
      parts.push(
        <Link
          key={`t-${match.index}`}
          to={`/app/tasks/${taskId}`}
          onClick={(e) => e.stopPropagation()}
          title="Open task"
          className="mx-px inline-flex max-w-[280px] items-center gap-1 rounded bg-ink-750 px-1.5 py-px align-baseline font-medium text-fg transition-colors hover:bg-ink-700 hover:text-brand"
        >
          <CheckSquare size={11} className="shrink-0 text-brand" />
          <span className="truncate">{taskRef}</span>
        </Link>,
      )
    } else if (url !== undefined) {
      parts.push(
        <a
          key={`u-${match.index}`}
          href={url}
          target="_blank"
          rel="noopener noreferrer"
          onClick={(e) => e.stopPropagation()}
          className="text-brand underline decoration-brand/40 underline-offset-2 hover:decoration-brand"
        >
          {url}
        </a>,
      )
    }
    lastIndex = re.lastIndex
  }
  if (lastIndex < body.length) {
    parts.push(body.slice(lastIndex))
  }

  return <>{parts}</>
}
