import { useMemo } from 'react'

import { useChannels, useCurrentContext } from '../lib/queries'
import type { Channel } from '../lib/types'

/**
 * "All Channels" data. Wraps the existing channels query and filters out direct
 * messages (which belong to the DM list, not the channel directory).
 *
 * TODO(backend): expose `is_pinned` / `is_archived` on the Channel model to
 * support the Pinned / Archived filters shown in the UI as future options.
 */
export function useAllChannels() {
  const { workspace } = useCurrentContext()
  const channels = useChannels(workspace?.id)

  const data = useMemo<Channel[]>(
    () => (channels.data ?? []).filter((c) => !c.is_direct),
    [channels.data],
  )

  return { data, isLoading: channels.isLoading, error: channels.error }
}
