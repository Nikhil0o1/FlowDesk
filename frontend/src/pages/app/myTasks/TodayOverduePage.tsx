import { useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'

import { MyTasksAgenda, MyWorkPanel } from '../../../components/myTasks/MyWorkPanel'
import { MyTasksBreadcrumbs } from '../../../components/myTasks/CrossProjectTaskList'
import { invalidateMyTasks, useMyTasks } from '../../../lib/myTasksQueries'
import { favoriteViewTarget } from '../../../lib/favorites'
import { useRealtime } from '../../../lib/ws'
import { CenteredSpinner } from '../../../components/ui/Spinner'

export default function TodayOverduePage() {
  const queryClient = useQueryClient()
  const [agendaDay, setAgendaDay] = useState(() => new Date())

  const assigned = useMyTasks({ relation: 'assigned', pageSize: 200 })
  const delegated = useMyTasks({ relation: 'delegated', pageSize: 100 })
  const done = useMyTasks({ relation: 'assigned', includeCompleted: true, pageSize: 200 })

  const loading = assigned.isLoading || delegated.isLoading || done.isLoading

  useRealtime(['task.updated', 'task.created', 'task.assigned', 'task.deleted'], () => {
    invalidateMyTasks(queryClient)
  })

  if (loading && !assigned.data) return <CenteredSpinner />

  const doneTasks = (done.data?.items ?? []).filter((t) => !!t.completed_at)

  return (
    <div className="flex h-full min-h-0 flex-col">
      <MyTasksBreadcrumbs
        leaf="Today & Overdue"
        favorite={favoriteViewTarget('/app/my-tasks/today-overdue', 'Today & Overdue')}
      />
      <div className="grid min-h-0 flex-1 grid-cols-1 lg:grid-cols-[minmax(280px,360px)_1fr]">
        <MyWorkPanel
          assignedTasks={assigned.data?.items ?? []}
          delegatedTasks={delegated.data?.items ?? []}
          doneTasks={doneTasks}
          loading={loading}
        />
        <MyTasksAgenda
          day={agendaDay}
          tasks={assigned.data?.items ?? []}
          onDayChange={setAgendaDay}
        />
      </div>
    </div>
  )
}
