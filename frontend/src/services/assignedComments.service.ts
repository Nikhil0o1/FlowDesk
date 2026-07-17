import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { api } from '../lib/api'
import type { Priority, UserBrief } from '../lib/types'

/**
 * Assigned Comments service.
 *
 * Backed by `GET /me/assigned-comments?relation=assigned|delegated`, which
 * aggregates task-comment @mentions and chat @mentions for the current user.
 *
 * "Resolved" is a client-side dismissal persisted to localStorage, because the
 * Mention model has no resolved state yet.
 * TODO(backend): add `resolved_at` to mentions + a resolve endpoint and replace
 * the localStorage logic below with the API call.
 */

export type AssignedRelation = 'assigned' | 'delegated'
export type AssignedSource = 'task' | 'chat'
export type AssignedStatus = 'pending' | 'resolved'

export interface AssignedComment {
  id: string
  source: AssignedSource
  title: string
  ref: string | null
  context: string
  preview: string
  url: string
  person: { name: string; avatarUrl?: string | null }
  at: string
  priority: Priority | null
  status: AssignedStatus
}

interface AssignedItemApi {
  id: string
  source: AssignedSource
  title: string
  ref: string | null
  context: string
  preview: string
  url: string
  person: UserBrief | null
  at: string
  priority: Priority | null
  status: AssignedStatus
}

export const ASSIGNED_COMMENTS_QUERY_KEY = ['assigned-comments'] as const

export function assignedCommentsKey(relation: AssignedRelation) {
  return [...ASSIGNED_COMMENTS_QUERY_KEY, relation] as const
}

const RESOLVED_KEY = 'flowdesk-resolved-comments'

function loadResolved(): Set<string> {
  try {
    return new Set(JSON.parse(localStorage.getItem(RESOLVED_KEY) ?? '[]') as string[])
  } catch {
    return new Set()
  }
}

function persistResolved(ids: Set<string>) {
  localStorage.setItem(RESOLVED_KEY, JSON.stringify([...ids]))
}

function mapItem(row: AssignedItemApi, resolved: Set<string>): AssignedComment {
  return {
    id: row.id,
    source: row.source,
    title: row.title,
    ref: row.ref,
    context: row.context,
    preview: row.preview,
    url: row.url,
    person: {
      name: row.person?.full_name || row.person?.email || 'Someone',
      avatarUrl: row.person?.avatar_url,
    },
    at: row.at,
    priority: row.priority,
    status: resolved.has(row.id) ? 'resolved' : row.status,
  }
}

export function useAssignedComments(relation: AssignedRelation) {
  return useQuery({
    queryKey: assignedCommentsKey(relation),
    queryFn: async () => {
      const rows = await api.get<AssignedItemApi[]>(`/me/assigned-comments?relation=${relation}`)
      const resolved = loadResolved()
      return rows.map((row) => mapItem(row, resolved))
    },
  })
}

export function useSetResolved() {
  const queryClient = useQueryClient()
  return useMutation({
    // TODO(backend): api.patch(`/assigned-comments/${id}/resolve`, { resolved })
    mutationFn: async ({ id, resolved }: { id: string; resolved: boolean }) => {
      const set = loadResolved()
      if (resolved) set.add(id)
      else set.delete(id)
      persistResolved(set)
      return { id, resolved }
    },
    onSuccess: ({ id, resolved }) => {
      queryClient.setQueriesData<AssignedComment[]>(
        { queryKey: ASSIGNED_COMMENTS_QUERY_KEY },
        (old) =>
          (old ?? []).map((c) =>
            c.id === id ? { ...c, status: resolved ? 'resolved' : 'pending' } : c,
          ),
      )
    },
  })
}
