import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  Activity,
  Calendar as CalendarIcon,
  Check,
  CheckCircle2,
  Columns3,
  GanttChart,
  GitBranch,
  Layers,
  LayoutList,
  ListFilter,
  Plus,
  Search,
  SquareKanban,
  Star,
  Table as TableIcon,
  UserRound,
  X,
} from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { useNavigate, useParams, useSearchParams } from 'react-router-dom'

import { api, errorMessage } from '../../lib/api'
import { useProject, useProjectTasks, useSpaces, useStatuses } from '../../lib/queries'
import { recordRecent } from '../../lib/recents'
import type { OrgMember, Priority, Task, TaskType } from '../../lib/types'
import { cn } from '../../lib/utils'
import { useRealtime } from '../../lib/ws'
import { useAuthStore } from '../../stores/auth'
import { toast } from '../../stores/toast'
import { GithubFeed } from '../../components/github/GithubFeed'
import { ProjectActivity } from '../../components/projects/ProjectActivity'
import { CalendarView } from '../../components/tasks/CalendarView'
import { GanttView } from '../../components/tasks/GanttView'
import { KanbanBoard } from '../../components/tasks/KanbanBoard'
import { TableView } from '../../components/tasks/TableView'
import { ALL_COLS, TaskTable, type ColKey, type GroupBy } from '../../components/tasks/TaskTable'
import { Avatar } from '../../components/ui/Avatar'
import { Dropdown } from '../../components/ui/Dropdown'
import { EmptyState } from '../../components/ui/EmptyState'
import { Modal } from '../../components/ui/Modal'
import { CenteredSpinner } from '../../components/ui/Spinner'

type View = 'list' | 'board' | 'calendar' | 'gantt' | 'table' | 'activity' | 'github'

const TASK_VIEWS: View[] = ['list', 'board', 'calendar', 'gantt', 'table']

const VIEW_TABS: { key: View; label: string; icon: React.ReactNode }[] = [
  { key: 'list', label: 'List', icon: <LayoutList size={14} className="text-fg-secondary" /> },
  { key: 'board', label: 'Board', icon: <SquareKanban size={14} className="text-[#5B9FF0]" /> },
  { key: 'calendar', label: 'Calendar', icon: <CalendarIcon size={14} className="text-[#F2994A]" /> },
  { key: 'gantt', label: 'Gantt', icon: <GanttChart size={14} className="text-[#E5484D]" /> },
  { key: 'table', label: 'Table', icon: <TableIcon size={14} className="text-[#4CB782]" /> },
  { key: 'activity', label: 'Activity', icon: <Activity size={14} className="text-fg-secondary" /> },
  { key: 'github', label: 'GitHub', icon: <GitBranch size={14} className="text-fg-secondary" /> },
]

export default function ProjectPage() {
  const { projectId } = useParams<{ projectId: string }>()
  const [params, setParams] = useSearchParams()
  const view = (params.get('view') as View) ?? 'list'
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  const user = useAuthStore((s) => s.user)

  const project = useProject(projectId)
  const statuses = useStatuses(projectId)
  const spaces = useSpaces(project.data?.workspace_id)
  const members = useQuery({
    queryKey: ['project-members', projectId],
    queryFn: () => api.get<OrgMember[]>(`/projects/${projectId}/members`),
    enabled: !!projectId,
  })

  // Toolbar state
  const [groupBy, setGroupBy] = useState<GroupBy>('status')
  const [showSubtasks, setShowSubtasks] = useState(false)
  const [visibleCols, setVisibleCols] = useState<ColKey[]>(ALL_COLS)
  const [priority, setPriority] = useState<Priority | ''>('')
  const [taskType, setTaskType] = useState<TaskType | ''>('')
  const [assigneeId, setAssigneeId] = useState<string>('')
  const [showClosed, setShowClosed] = useState(false)
  const [searchOpen, setSearchOpen] = useState(false)
  const [q, setQ] = useState('')
  const [addTaskOpen, setAddTaskOpen] = useState(false)

  const filterParams = useMemo(() => {
    let s = ''
    if (q.trim()) s += `&q=${encodeURIComponent(q.trim())}`
    if (priority) s += `&priority=${priority}`
    if (taskType) s += `&task_type=${taskType}`
    if (assigneeId) s += `&assignee_id=${assigneeId}`
    if (showSubtasks) s += `&include_subtasks=true`
    return s
  }, [q, priority, taskType, assigneeId, showSubtasks])

  const tasks = useProjectTasks(projectId, filterParams)

  useRealtime(
    ['task.created', 'task.updated', 'task.deleted', 'task.assigned'],
    (event) => {
      if (event.project_id === projectId) {
        void queryClient.invalidateQueries({ queryKey: ['tasks', projectId] })
      }
    },
    [projectId],
  )

  const spaceName = spaces.data?.find((s) => s.id === project.data?.space_id)?.name
  useEffect(() => {
    if (project.data) {
      recordRecent({ type: 'project', id: project.data.id, label: project.data.name, sublabel: spaceName })
    }
  }, [project.data?.id, spaceName])

  if (project.isLoading) return <CenteredSpinner />
  if (!project.data) {
    return <EmptyState icon={Layers} title="Project not found" description="It may have been deleted or you don't have access." />
  }

  const proj = project.data
  const space = spaces.data?.find((s) => s.id === proj.space_id)
  const canEdit = proj.my_role !== 'viewer'
  const isTaskView = TASK_VIEWS.includes(view)

  const visibleTasks = (tasks.data?.items ?? []).filter(
    (t) => showClosed || !t.completed_at,
  )

  const setView = (v: View) => {
    params.set('view', v)
    setParams(params, { replace: true })
  }

  const filterCount = (priority ? 1 : 0) + (taskType ? 1 : 0)
  const assigneeMember = members.data?.find((m) => m.user_id === assigneeId)

  return (
    <div className="flex h-full flex-col">
      {/* ---- Breadcrumb + view tabs ---- */}
      <div className="shrink-0 border-b border-ink-700 px-6 pt-3">
        <div className="flex items-center gap-2 text-sm">
          {space && (
            <>
              <span className="flex items-center gap-1.5 text-fg-secondary">
                <span
                  className="flex items-center justify-center rounded text-[9px] font-bold text-white"
                  style={{ backgroundColor: space.color, width: 18, height: 18 }}
                >
                  {space.name[0]}
                </span>
                {space.name}
              </span>
              <span className="text-fg-muted">/</span>
            </>
          )}
          <span className="flex items-center gap-1.5 font-semibold text-fg">
            <LayoutList size={15} style={{ color: proj.color }} />
            {proj.name}
          </span>
          <Star size={14} className="cursor-pointer text-fg-muted hover:text-amber-400" />
          <span className="rounded bg-ink-750 px-1.5 py-0.5 text-[10px] font-semibold text-fg-secondary">
            {proj.key}
          </span>
        </div>

        <div className="mt-2 flex items-center">
          <button
            onClick={() => navigate('/app/chat?new=1')}
            className="mr-2 rounded-lg border border-ink-700 px-2.5 py-1 text-xs font-medium text-fg-secondary transition-colors hover:bg-ink-800 hover:text-fg"
          >
            Add Channel
          </button>
          <span className="mr-1 h-4 w-px bg-ink-700" />
          {VIEW_TABS.map((tab) => (
            <button
              key={tab.key}
              onClick={() => setView(tab.key)}
              className={cn(
                'flex items-center gap-1.5 border-b-2 px-2.5 py-2 text-sm transition-colors',
                view === tab.key
                  ? 'border-fg font-semibold text-fg'
                  : 'border-transparent text-fg-secondary hover:text-fg',
              )}
            >
              {tab.icon}
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      {/* ---- Toolbar ---- */}
      {isTaskView && (
        <div className="flex shrink-0 flex-wrap items-center gap-1.5 px-6 py-2.5">
          {/* Group by */}
          {(view === 'list' || view === 'board') && (
            <Dropdown
              width="w-40"
              trigger={
                <button className="flex items-center gap-1.5 rounded-full bg-brand-soft px-3 py-1.5 text-xs font-medium text-brand transition-colors hover:bg-brand/25">
                  <Layers size={13} />
                  Group: {view === 'board' ? 'Status' : groupBy === 'none' ? 'None' : groupBy[0].toUpperCase() + groupBy.slice(1)}
                </button>
              }
            >
              {(close) =>
                (view === 'board' ? (['status'] as GroupBy[]) : (['status', 'priority', 'none'] as GroupBy[])).map(
                  (option) => (
                    <button
                      key={option}
                      className="menu-item capitalize"
                      onClick={() => {
                        setGroupBy(option)
                        close()
                      }}
                    >
                      <span className="flex-1">{option}</span>
                      {groupBy === option && <Check size={14} className="text-brand" />}
                    </button>
                  ),
                )
              }
            </Dropdown>
          )}

          {/* Subtasks */}
          {(view === 'list' || view === 'board' || view === 'table') && (
            <button
              className={cn(
                'flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium transition-colors',
                showSubtasks ? 'bg-brand-soft text-brand' : 'text-fg-secondary hover:bg-ink-750 hover:text-fg',
              )}
              onClick={() => setShowSubtasks((v) => !v)}
            >
              <GitBranch size={13} /> Subtasks
            </button>
          )}

          {/* Columns */}
          {view === 'list' && (
            <Dropdown
              width="w-44"
              trigger={
                <button className="flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium text-fg-secondary transition-colors hover:bg-ink-750 hover:text-fg">
                  <Columns3 size={13} /> Columns
                </button>
              }
            >
              {() =>
                ALL_COLS.map((col) => (
                  <label key={col} className="menu-item cursor-pointer capitalize">
                    <input
                      type="checkbox"
                      className="accent-brand"
                      checked={visibleCols.includes(col)}
                      onChange={(e) =>
                        setVisibleCols((prev) =>
                          e.target.checked
                            ? ALL_COLS.filter((c) => prev.includes(c) || c === col)
                            : prev.filter((c) => c !== col),
                        )
                      }
                    />
                    {col === 'due' ? 'Due date' : col}
                  </label>
                ))
              }
            </Dropdown>
          )}

          <span className="flex-1" />

          {/* Filter */}
          <Dropdown
            align="right"
            width="w-56"
            trigger={
              <button
                className={cn(
                  'flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium transition-colors',
                  filterCount > 0 ? 'bg-brand-soft text-brand' : 'text-fg-secondary hover:bg-ink-750 hover:text-fg',
                )}
              >
                <ListFilter size={13} /> Filter{filterCount > 0 ? ` (${filterCount})` : ''}
              </button>
            }
          >
            {() => (
              <div className="space-y-2.5 p-2">
                <div>
                  <p className="mb-1 text-[11px] font-semibold uppercase tracking-wider text-fg-muted">Priority</p>
                  <select className="input-dark !py-1.5 text-xs" value={priority} onChange={(e) => setPriority(e.target.value as Priority | '')}>
                    <option value="">Any</option>
                    <option value="urgent">Urgent</option>
                    <option value="high">High</option>
                    <option value="normal">Normal</option>
                    <option value="low">Low</option>
                  </select>
                </div>
                <div>
                  <p className="mb-1 text-[11px] font-semibold uppercase tracking-wider text-fg-muted">Type</p>
                  <select className="input-dark !py-1.5 text-xs" value={taskType} onChange={(e) => setTaskType(e.target.value as TaskType | '')}>
                    <option value="">Any</option>
                    <option value="task">Task</option>
                    <option value="bug">Bug</option>
                    <option value="story">Story</option>
                    <option value="epic">Epic</option>
                  </select>
                </div>
                {filterCount > 0 && (
                  <button
                    className="w-full text-center text-xs text-brand hover:text-brand-hover"
                    onClick={() => {
                      setPriority('')
                      setTaskType('')
                    }}
                  >
                    Clear filters
                  </button>
                )}
              </div>
            )}
          </Dropdown>

          {/* Closed */}
          <button
            className={cn(
              'flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium transition-colors',
              showClosed ? 'bg-brand-soft text-brand' : 'text-fg-secondary hover:bg-ink-750 hover:text-fg',
            )}
            onClick={() => setShowClosed((v) => !v)}
          >
            <CheckCircle2 size={13} /> Closed
          </button>

          {/* Assignee */}
          <Dropdown
            align="right"
            width="w-56"
            trigger={
              <button
                className={cn(
                  'flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium transition-colors',
                  assigneeId ? 'bg-brand-soft text-brand' : 'text-fg-secondary hover:bg-ink-750 hover:text-fg',
                )}
              >
                <UserRound size={13} />
                {assigneeMember?.user ? assigneeMember.user.full_name.split(' ')[0] || 'Assignee' : 'Assignee'}
              </button>
            }
          >
            {(close) => (
              <>
                <button
                  className="menu-item"
                  onClick={() => {
                    setAssigneeId('')
                    close()
                  }}
                >
                  <span className="flex-1">Anyone</span>
                  {!assigneeId && <Check size={14} className="text-brand" />}
                </button>
                {(members.data ?? []).map((member) => (
                  <button
                    key={member.user_id}
                    className="menu-item"
                    onClick={() => {
                      setAssigneeId(member.user_id)
                      close()
                    }}
                  >
                    <Avatar name={member.user?.full_name || member.user?.email || '?'} src={member.user?.avatar_url} size={20} />
                    <span className="flex-1 truncate">{member.user?.full_name || member.user?.email}</span>
                    {assigneeId === member.user_id && <Check size={14} className="text-brand" />}
                  </button>
                ))}
              </>
            )}
          </Dropdown>

          {/* Me shortcut avatar */}
          {user && (
            <button
              title="Assigned to me"
              onClick={() => setAssigneeId((prev) => (prev === user.id ? '' : user.id))}
              className={cn(
                'rounded-full ring-2 transition-shadow',
                assigneeId === user.id ? 'ring-brand' : 'ring-transparent hover:ring-ink-600',
              )}
            >
              <Avatar name={user.profile?.full_name || user.email} src={user.profile?.avatar_url} size={26} />
            </button>
          )}

          {/* Search */}
          {searchOpen ? (
            <div className="relative">
              <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-fg-muted" />
              <input
                autoFocus
                value={q}
                onChange={(e) => setQ(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Escape') {
                    setQ('')
                    setSearchOpen(false)
                  }
                }}
                placeholder="Search tasks"
                className="w-44 rounded-full border border-ink-700 bg-ink-800 py-1.5 pl-8 pr-7 text-xs text-fg outline-none transition-colors focus:border-brand"
              />
              <button
                className="absolute right-2 top-1/2 -translate-y-1/2 text-fg-muted hover:text-fg"
                onClick={() => {
                  setQ('')
                  setSearchOpen(false)
                }}
              >
                <X size={12} />
              </button>
            </div>
          ) : (
            <button className="btn-ghost !rounded-full !px-2" onClick={() => setSearchOpen(true)} title="Search tasks">
              <Search size={14} />
            </button>
          )}

          {/* Add Task */}
          {canEdit && (
            <button
              onClick={() => setAddTaskOpen(true)}
              className="flex items-center gap-1 rounded-lg bg-white px-3 py-1.5 text-xs font-semibold text-gray-900 transition-colors hover:bg-gray-200"
            >
              Add Task
            </button>
          )}
        </div>
      )}

      {/* ---- Content ---- */}
      <div className={cn('min-h-0 flex-1', view === 'calendar' || view === 'gantt' ? 'overflow-hidden' : 'overflow-y-auto')}>
        {isTaskView && (tasks.isLoading || statuses.isLoading) ? (
          <CenteredSpinner />
        ) : (
          <>
            {view === 'list' && (
              <TaskTable
                projectId={proj.id}
                tasks={visibleTasks}
                statuses={statuses.data ?? []}
                canEdit={canEdit}
                groupBy={groupBy}
                cols={visibleCols}
              />
            )}
            {view === 'board' && (
              <KanbanBoard projectId={proj.id} tasks={visibleTasks} statuses={statuses.data ?? []} canEdit={canEdit} />
            )}
            {view === 'calendar' && <CalendarView projectId={proj.id} tasks={visibleTasks} canEdit={canEdit} />}
            {view === 'gantt' && (
              <GanttView projectId={proj.id} projectName={proj.name} tasks={visibleTasks} canEdit={canEdit} />
            )}
            {view === 'table' && <TableView projectId={proj.id} tasks={visibleTasks} canEdit={canEdit} />}
            {view === 'activity' && <ProjectActivity projectId={proj.id} />}
            {view === 'github' && <GithubFeed projectId={proj.id} />}
          </>
        )}
      </div>

      <AddTaskModal projectId={proj.id} open={addTaskOpen} onClose={() => setAddTaskOpen(false)} />
    </div>
  )
}

function AddTaskModal({ projectId, open, onClose }: { projectId: string; open: boolean; onClose: () => void }) {
  const [title, setTitle] = useState('')
  const queryClient = useQueryClient()
  const navigate = useNavigate()

  const create = useMutation({
    mutationFn: () => api.post<Task>(`/projects/${projectId}/tasks`, { title: title.trim() }),
    onSuccess: (task) => {
      toast.success(`${task.ref} created`)
      setTitle('')
      void queryClient.invalidateQueries({ queryKey: ['tasks'] })
      onClose()
      navigate(`/app/tasks/${task.id}`)
    },
    onError: (err) => toast.error(errorMessage(err)),
  })

  return (
    <Modal open={open} onClose={onClose} title="Add Task" width="max-w-md">
      <div className="space-y-3">
        <input
          autoFocus
          className="input-dark"
          placeholder="Task Name"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && title.trim() && create.mutate()}
        />
        <button className="btn-primary w-full" disabled={!title.trim() || create.isPending} onClick={() => create.mutate()}>
          <Plus size={14} /> Create task
        </button>
      </div>
    </Modal>
  )
}
