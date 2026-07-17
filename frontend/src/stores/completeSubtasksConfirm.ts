import { create } from 'zustand'

type Resolver = (confirmed: boolean) => void

interface CompleteSubtasksConfirmState {
  open: boolean
  pendingCount: number
  taskTitle: string | null
  resolve: Resolver | null
  ask: (opts: { pendingCount: number; taskTitle?: string | null }) => Promise<boolean>
  confirm: () => void
  cancel: () => void
}

export const useCompleteSubtasksConfirmStore = create<CompleteSubtasksConfirmState>((set, get) => ({
  open: false,
  pendingCount: 0,
  taskTitle: null,
  resolve: null,
  ask: ({ pendingCount, taskTitle }) =>
    new Promise<boolean>((resolve) => {
      const prev = get().resolve
      if (prev) prev(false)
      set({ open: true, pendingCount, taskTitle: taskTitle ?? null, resolve })
    }),
  confirm: () => {
    const { resolve } = get()
    resolve?.(true)
    set({ open: false, pendingCount: 0, taskTitle: null, resolve: null })
  },
  cancel: () => {
    const { resolve } = get()
    resolve?.(false)
    set({ open: false, pendingCount: 0, taskTitle: null, resolve: null })
  },
}))

export function askCompleteWithSubtasks(opts: {
  pendingCount: number
  taskTitle?: string | null
}): Promise<boolean> {
  return useCompleteSubtasksConfirmStore.getState().ask(opts)
}
