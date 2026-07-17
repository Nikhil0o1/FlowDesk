import { useEffect } from 'react'

/** Clears draft form state each time a create modal opens. */
export function useResetFormWhenOpen(open: boolean, reset: () => void) {
  useEffect(() => {
    if (open) reset()
  }, [open, reset])
}
