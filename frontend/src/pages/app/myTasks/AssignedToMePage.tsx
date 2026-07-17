import { useQueryClient } from '@tanstack/react-query'
import { useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'

import { CrossProjectTaskList, MyTasksBreadcrumbs } from '../../../components/myTasks/CrossProjectTaskList'
import { invalidateMyTasks, useMyTasks } from '../../../lib/myTasksQueries'
import { favoriteViewTarget } from '../../../lib/favorites'
import { parseTaskDueFilter } from '../../../lib/projectMemberDashboardRoutes'
import { useRealtime } from '../../../lib/ws'
import { CenteredSpinner } from '../../../components/ui/Spinner'

export default function AssignedToMePage() {
  const queryClient = useQueryClient()
  const [params] = useSearchParams()
  const due = parseTaskDueFilter(params.get('due'))
  const [includeCompleted, setIncludeCompleted] = useState(params.get('include_completed') === 'true')

  const queryOpts = useMemo(
    () => ({
      relation: 'assigned' as const,
      includeCompleted,
      due: due || undefined,
      pageSize: 200,
    }),
    [includeCompleted, due],
  )

  const { data, isLoading, isError, error } = useMyTasks(queryOpts)

  useRealtime(['task.updated', 'task.created', 'task.assigned', 'task.deleted'], () => {
    invalidateMyTasks(queryClient)
  })

  if (isLoading && !data) return <CenteredSpinner />

  return (
    <div className="flex h-full min-h-0 flex-col">
      <MyTasksBreadcrumbs
        leaf="Assigned to me"
        favorite={favoriteViewTarget('/app/my-tasks/assigned', 'Assigned to me')}
      />
      {isError && (
        <p className="border-b border-red-500/30 bg-red-500/10 px-6 py-2 text-sm text-red-400">
          Could not load tasks: {(error as Error)?.message ?? 'Request failed'}
        </p>
      )}
      <CrossProjectTaskList
        tasks={data?.items ?? []}
        showSubtasks={false}
        includeCompleted={includeCompleted}
        onIncludeCompletedChange={setIncludeCompleted}
        emptyDescription={
          isError
            ? 'Fix the error above, then refresh.'
            : 'Tasks assigned to you will appear here.'
        }
      />
    </div>
  )
}
