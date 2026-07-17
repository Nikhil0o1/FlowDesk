import { beforeEach, describe, expect, it } from 'vitest'

import {
  askCompleteWithSubtasks,
  useCompleteSubtasksConfirmStore,
} from '@/stores/completeSubtasksConfirm'

describe('completeSubtasksConfirm store', () => {
  beforeEach(() => {
    useCompleteSubtasksConfirmStore.setState({
      open: false,
      pendingCount: 0,
      taskTitle: null,
      resolve: null,
    })
  })

  it('resolves true when confirmed', async () => {
    const pending = askCompleteWithSubtasks({ pendingCount: 2, taskTitle: 'Parent task' })
    expect(useCompleteSubtasksConfirmStore.getState().open).toBe(true)
    expect(useCompleteSubtasksConfirmStore.getState().pendingCount).toBe(2)
    useCompleteSubtasksConfirmStore.getState().confirm()
    await expect(pending).resolves.toBe(true)
    expect(useCompleteSubtasksConfirmStore.getState().open).toBe(false)
  })

  it('resolves false when cancelled', async () => {
    const pending = askCompleteWithSubtasks({ pendingCount: 1 })
    useCompleteSubtasksConfirmStore.getState().cancel()
    await expect(pending).resolves.toBe(false)
  })

  it('cancels a previous pending prompt when ask is called again', async () => {
    const first = askCompleteWithSubtasks({ pendingCount: 1, taskTitle: 'First' })
    const second = askCompleteWithSubtasks({ pendingCount: 3, taskTitle: 'Second' })
    await expect(first).resolves.toBe(false)
    useCompleteSubtasksConfirmStore.getState().confirm()
    await expect(second).resolves.toBe(true)
  })
})
