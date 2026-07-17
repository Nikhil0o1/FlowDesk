import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'

import { activityForDoc } from '../services/activity.service'
import { docsKeys, fetchActivity } from '../services/docsApi.service'
import type { ActivityType } from '../types/activity'

/** Activity timeline for a document — read-only from API (server logs mutations). */
export function useActivity(documentId: string) {
  const activityQuery = useQuery({
    queryKey: docsKeys.activity(documentId),
    queryFn: () => fetchActivity(documentId),
    enabled: !!documentId,
  })

  const events = useMemo(
    () => activityForDoc(activityQuery.data ?? [], documentId),
    [activityQuery.data, documentId],
  )

  /** Client-side activity logging is handled server-side; kept for call-site compatibility. */
  const log = (_type: ActivityType, _detail: string) => {}

  return { events, log, count: events.length, isLoading: activityQuery.isLoading }
}
