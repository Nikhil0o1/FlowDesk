import { useMemo } from 'react'

import { useCurrentContext, useProjects, useSpaces } from '../lib/queries'
import type { Space } from '../lib/types'

export interface AllSpacesItem extends Space {
  /** Number of (non-archived) projects inside this space. */
  projectCount: number
}

/**
 * "All Spaces" data. Built on the existing spaces + projects queries and
 * enriched with a computed project count.
 *
 * TODO(backend): a dedicated `GET /spaces` returning member_count / description
 * per space would let us drop the client-side project aggregation.
 */
export function useAllSpaces() {
  const { workspace } = useCurrentContext()
  const spaces = useSpaces(workspace?.id)
  const projects = useProjects(workspace?.id)

  const data = useMemo<AllSpacesItem[]>(() => {
    const spaceList = spaces.data ?? []
    const projectList = projects.data ?? []
    return spaceList.map((space) => ({
      ...space,
      projectCount: projectList.filter((p) => p.space_id === space.id && !p.is_archived).length,
    }))
  }, [spaces.data, projects.data])

  return {
    data,
    isLoading: spaces.isLoading || projects.isLoading,
    error: spaces.error ?? projects.error,
  }
}
