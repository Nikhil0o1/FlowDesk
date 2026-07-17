import type { MyTasksCardId } from './myTasksCards'

export type MyTasksCardSize = {
  height: number
  /** Columns (of 12) on large screens — 6 = half width, 12 = full width. */
  colSpan: number
}

export const MY_TASKS_CARD_HEIGHT_MIN = 160
export const MY_TASKS_CARD_HEIGHT_MAX = 900
export const MY_TASKS_CARD_COL_SPAN_MIN = 4
export const MY_TASKS_CARD_COL_SPAN_MAX = 12

export const DEFAULT_MY_TASKS_CARD_SIZES: Record<MyTasksCardId, MyTasksCardSize> = {
  recents: { height: 320, colSpan: 6 },
  agenda: { height: 360, colSpan: 6 },
  my_work: { height: 360, colSpan: 6 },
  assigned_comments: { height: 300, colSpan: 6 },
  personal_list: { height: 300, colSpan: 6 },
  assigned: { height: 480, colSpan: 12 },
  created: { height: 480, colSpan: 12 },
}

export function clampMyTasksCardHeight(height: number): number {
  return Math.round(
    Math.min(MY_TASKS_CARD_HEIGHT_MAX, Math.max(MY_TASKS_CARD_HEIGHT_MIN, height)),
  )
}

export function clampMyTasksCardColSpan(span: number): number {
  const clamped = Math.round(
    Math.min(MY_TASKS_CARD_COL_SPAN_MAX, Math.max(MY_TASKS_CARD_COL_SPAN_MIN, span)),
  )
  return clamped % 2 === 0 ? clamped : clamped - 1
}

export function resolveMyTasksCardSize(
  cardId: MyTasksCardId,
  overrides?: Partial<MyTasksCardSize>,
): MyTasksCardSize {
  const base = DEFAULT_MY_TASKS_CARD_SIZES[cardId]
  return {
    height: clampMyTasksCardHeight(overrides?.height ?? base.height),
    colSpan: clampMyTasksCardColSpan(overrides?.colSpan ?? base.colSpan),
  }
}

export function colSpanFromPixelWidth(widthPx: number, gridWidthPx: number): number {
  if (gridWidthPx <= 0) return MY_TASKS_CARD_COL_SPAN_MIN
  const span = Math.round((widthPx / gridWidthPx) * 12)
  return clampMyTasksCardColSpan(span)
}
