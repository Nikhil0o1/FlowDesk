import { useCallback } from 'react'

import { useCurrentContext, useWorkspaceMembers } from '../../../lib/queries'
import { toMentionMarkup } from '../../../lib/utils'

/** Workspace-scoped @mention helpers for doc comments. */
export function useMentions() {
  const { workspace } = useCurrentContext()
  const { data: members } = useWorkspaceMembers(workspace?.id)

  const candidates = members ?? []

  const serialize = useCallback((text: string, mentionMap: Map<string, string>) => toMentionMarkup(text, mentionMap), [])

  return { candidates, serialize }
}
