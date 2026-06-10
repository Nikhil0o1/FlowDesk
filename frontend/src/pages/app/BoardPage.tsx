import { SquareKanban } from 'lucide-react'
import { useState } from 'react'

import { useCurrentContext, useProjects, useProjectTasks, useStatuses } from '../../lib/queries'
import { KanbanBoard } from '../../components/tasks/KanbanBoard'
import { EmptyState } from '../../components/ui/EmptyState'
import { CenteredSpinner } from '../../components/ui/Spinner'

/** Standalone board view with a project picker. */
export default function BoardPage() {
  const { workspace } = useCurrentContext()
  const projects = useProjects(workspace?.id)
  const [projectId, setProjectId] = useState('')

  const effectiveId = projectId || projects.data?.[0]?.id
  const project = projects.data?.find((p) => p.id === effectiveId)
  const statuses = useStatuses(effectiveId)
  const tasks = useProjectTasks(effectiveId)

  if (projects.isLoading) return <CenteredSpinner />
  if ((projects.data ?? []).length === 0) {
    return <EmptyState icon={SquareKanban} title="No projects" description="Create a project to see its board here." />
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex shrink-0 items-center gap-3 px-6 py-4">
        <h1 className="text-xl font-bold text-fg">Board</h1>
        <select className="input-dark !w-auto !py-1.5 text-xs" value={effectiveId} onChange={(e) => setProjectId(e.target.value)}>
          {(projects.data ?? []).map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
      </div>
      <div className="min-h-0 flex-1">
        {tasks.isLoading || statuses.isLoading ? (
          <CenteredSpinner />
        ) : (
          <KanbanBoard
            projectId={effectiveId!}
            tasks={(tasks.data?.items ?? []).filter((t) => !t.parent_task_id)}
            statuses={statuses.data ?? []}
            canEdit={project?.my_role !== 'viewer'}
          />
        )}
      </div>
    </div>
  )
}
