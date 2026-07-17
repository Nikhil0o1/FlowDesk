export const MY_TASKS_CARD_IDS = [
  'recents',
  'agenda',
  'my_work',
  'assigned_comments',
  'personal_list',
  'assigned',
  'created',
] as const

export type MyTasksCardId = (typeof MY_TASKS_CARD_IDS)[number]

export const MY_TASKS_CARD_LABELS: Record<MyTasksCardId, string> = {
  recents: 'Recents',
  agenda: 'Agenda',
  my_work: 'My Work',
  assigned_comments: 'Assigned comments',
  personal_list: 'Personal List',
  assigned: 'Assigned to me',
  created: 'Created by me',
}

/** Cards that span the full dashboard width (ClickUp: Assigned to me). */
export const MY_TASKS_FULL_WIDTH_CARDS = new Set<MyTasksCardId>(['assigned', 'created'])

export const DEFAULT_MY_TASKS_VISIBLE_CARDS: MyTasksCardId[] = [...MY_TASKS_CARD_IDS]

const LEGACY_CARD_IDS = new Set(['lineup', 'priorities'])

export function normalizeMyTasksCards(cards: string[]): MyTasksCardId[] {
  const valid = sanitizeMyTasksCards(cards)
  const order = valid.length > 0 ? valid : [...DEFAULT_MY_TASKS_VISIBLE_CARDS]
  for (const id of DEFAULT_MY_TASKS_VISIBLE_CARDS) {
    if (!order.includes(id)) {
      if (id === 'recents') order.unshift(id)
      else order.push(id)
    }
  }
  return order
}

/** Keep user-hidden cards hidden — only drop invalid/legacy ids. */
export function sanitizeMyTasksCards(cards: string[]): MyTasksCardId[] {
  return cards.filter(
    (c): c is MyTasksCardId =>
      (MY_TASKS_CARD_IDS as readonly string[]).includes(c) && !LEGACY_CARD_IDS.has(c),
  )
}
