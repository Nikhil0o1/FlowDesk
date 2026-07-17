import { useCallback } from 'react'
import { useSearchParams } from 'react-router-dom'

/**
 * URL-driven modal visibility (e.g. ?new=1). Keeps sidebar / create-menu deep links
 * in sync when the page stays mounted across navigations.
 */
export function useQueryFlagModal(flag = 'new', value = '1') {
  const [params, setParams] = useSearchParams()
  const isOpen = params.get(flag) === value

  const open = useCallback(() => {
    setParams(
      (prev) => {
        const next = new URLSearchParams(prev)
        next.set(flag, value)
        return next
      },
      { replace: true },
    )
  }, [flag, value, setParams])

  const close = useCallback(() => {
    setParams(
      (prev) => {
        const next = new URLSearchParams(prev)
        next.delete(flag)
        return next
      },
      { replace: true },
    )
  }, [flag, setParams])

  return { isOpen, open, close }
}
