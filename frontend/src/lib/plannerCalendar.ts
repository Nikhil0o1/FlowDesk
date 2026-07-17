import type { CalendarEvent, Task } from './types'

/** Google event ids already represented by a FlowDesk task block. */
export function collectLinkedGoogleEventIds(tasks: Iterable<Task>): Set<string> {
  const ids = new Set<string>()
  for (const task of tasks) {
    if (task.google_calendar_event_id) ids.add(task.google_calendar_event_id)
  }
  return ids
}

/** Drop calendar events that mirror a synced FlowDesk task (avoids double render). */
export function filterExternalCalendarEvents(
  events: CalendarEvent[],
  linkedEventIds: ReadonlySet<string>,
): CalendarEvent[] {
  if (linkedEventIds.size === 0) return events
  return events.filter((event) => !linkedEventIds.has(event.id))
}

export interface PlannerWeekView {
  timedTasks: Task[]
  tasksByDay: Map<string, Task[]>
  calendarEvents: CalendarEvent[]
  linkedGoogleEventIds: Set<string>
}

/** Merge task partitions with deduped external calendar events for the week grid. */
export function buildPlannerWeekView(
  tasks: Task[],
  events: CalendarEvent[],
  partition: (tasks: Task[]) => { timed: Task[]; allDay: Map<string, Task[]> },
): PlannerWeekView {
  const linkedGoogleEventIds = collectLinkedGoogleEventIds(tasks)
  const { timed, allDay } = partition(tasks)
  return {
    timedTasks: timed,
    tasksByDay: allDay,
    calendarEvents: filterExternalCalendarEvents(events, linkedGoogleEventIds),
    linkedGoogleEventIds,
  }
}
