import type { Task } from './types'

export const PLANNER_HOUR_PX = 60

export function startOfWeek(d: Date): Date {
  const out = new Date(d)
  out.setHours(0, 0, 0, 0)
  out.setDate(out.getDate() - ((out.getDay() + 6) % 7)) // Monday
  return out
}

export function addDays(d: Date, n: number): Date {
  const out = new Date(d)
  out.setDate(out.getDate() + n)
  return out
}

/** Local YYYY-MM-DD (not UTC-shifted). */
export function dayKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

export function tasksByDayMap(tasks: Task[]): Map<string, Task[]> {
  const map = new Map<string, Task[]>()
  for (const task of tasks) {
    if (!task.due_date || isTimedPlannerTask(task)) continue
    const list = map.get(task.due_date) ?? []
    list.push(task)
    map.set(task.due_date, list)
  }
  return map
}

export function isTimedPlannerTask(task: Task): boolean {
  return !!(task.planned_start_at && task.planned_end_at)
}

/** Open tasks due on a calendar day without a planned time slot. */
export function dueDateOnlyTasksForDay(tasks: Task[], key: string, includeCompleted = false): Task[] {
  return tasks.filter((task) => {
    if (task.due_date !== key) return false
    if (isTimedPlannerTask(task)) return false
    if (!includeCompleted && task.completed_at) return false
    return true
  })
}

export function timedTasksForDay(tasks: Task[], key: string): Task[] {
  return tasks.filter(
    (task) =>
      task.planned_start_at &&
      task.planned_end_at &&
      dayKey(new Date(task.planned_start_at)) === key,
  )
}

/** Default hour for plotting date-only due tasks on the day timeline (9:00 AM). */
export const AGENDA_DUE_DEFAULT_HOUR = 9
/** Fixed pixel height so title + "Due" label are not clipped. */
export const AGENDA_DUE_BLOCK_HEIGHT_PX = 44
export const AGENDA_DUE_STACK_GAP_PX = 4

export type AgendaDueTaskLayout = {
  task: Task
  top: number
  height: number
  /** Vertical stack index starting at 9 AM. */
  stackIndex: number
  stackCount: number
}

/** Stack due-date-only tasks vertically at 9 AM (full-width blocks). */
export function layoutDueDateTasksOnTimeline(tasks: Task[], key: string): AgendaDueTaskLayout[] {
  const dueTasks = dueDateOnlyTasksForDay(tasks, key)
  if (dueTasks.length === 0) return []

  const blockHeight = AGENDA_DUE_BLOCK_HEIGHT_PX
  const baseTop = AGENDA_DUE_DEFAULT_HOUR * PLANNER_HOUR_PX
  const stackCount = dueTasks.length
  const stride = blockHeight + AGENDA_DUE_STACK_GAP_PX

  return dueTasks.map((task, stackIndex) => ({
    task,
    top: baseTop + stackIndex * stride,
    height: blockHeight,
    stackIndex,
    stackCount,
  }))
}

/** Split week tasks into all-day (due date only) vs timed (planned slot + Google sync). */
export function partitionPlannerTasks(tasks: Task[]) {
  const timed: Task[] = []
  const allDay = new Map<string, Task[]>()
  for (const task of tasks) {
    if (isTimedPlannerTask(task)) {
      timed.push(task)
    } else if (task.due_date) {
      const list = allDay.get(task.due_date) ?? []
      list.push(task)
      allDay.set(task.due_date, list)
    }
  }
  return { timed, allDay }
}

export function plannerWeekTasksPath(weekStart: Date, days = 7): string {
  const start = dayKey(weekStart)
  const end = dayKey(addDays(weekStart, days - 1))
  const pageSize = Math.max(100, days * 20)
  return `/me/tasks?relation=assigned&due_from=${start}&due_to=${end}&page_size=${pageSize}`
}
