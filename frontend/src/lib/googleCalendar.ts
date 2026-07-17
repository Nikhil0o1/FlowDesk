import { useQuery } from '@tanstack/react-query'

import { api, errorMessage } from './api'
import type { CalendarStatus } from './types'
import { toast } from '../stores/toast'

export function useCalendarStatus() {
  return useQuery({
    queryKey: ['calendar-status'],
    queryFn: () => api.get<CalendarStatus>('/calendar/status'),
    staleTime: 5 * 60_000,
    retry: 1,
  })
}

export type GoogleConnectTool = 'calendar' | 'gmail' | 'sheets'

export async function startGoogleConnect(tool: GoogleConnectTool = 'calendar') {
  try {
    const { url } = await api.get<{ url: string }>(`/calendar/google/auth-url?tool=${tool}`)
    window.location.href = url
  } catch (err) {
    toast.error(errorMessage(err))
  }
}
