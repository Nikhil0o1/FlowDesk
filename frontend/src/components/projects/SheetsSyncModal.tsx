import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Clock4, ExternalLink, FileSpreadsheet, RefreshCw } from 'lucide-react'
import { useState } from 'react'

import { api, errorMessage } from '../../lib/api'
import { openExternalUrl } from '../../lib/safeUrl'
import { toast } from '../../stores/toast'
import { Modal } from '../ui/Modal'

interface SheetSyncStatus {
  enabled: boolean
  mode: 'export' | 'two_way' | null
  url: string | null
  last_synced_at: string | null
}

/** Project → Google Sheets: one-off export, live/two-way sync toggle, time report.
 * Wraps the same endpoints the ProjectPage Sheets menu uses. */
export function SheetsSyncModal({
  open,
  onClose,
  projectId,
  canManage,
}: {
  open: boolean
  onClose: () => void
  projectId: string
  canManage: boolean
}) {
  const queryClient = useQueryClient()
  const [busy, setBusy] = useState(false)
  const sync = useQuery({
    queryKey: ['sheet-sync', projectId],
    queryFn: () => api.get<SheetSyncStatus>(`/projects/${projectId}/sheets/sync`),
    enabled: open,
  })

  const run = async (fn: () => Promise<void>) => {
    setBusy(true)
    try {
      await fn()
    } catch (err) {
      toast.error(errorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  const exportNow = () =>
    run(async () => {
      const { url } = await api.post<{ url: string }>(`/projects/${projectId}/sheets/export`)
      toast.success('Exported to Google Sheets')
      openExternalUrl(url)
    })

  const exportTimeReport = () =>
    run(async () => {
      const { url } = await api.post<{ url: string }>(`/projects/${projectId}/sheets/time-report`)
      toast.success('Time report exported — Entries + Summary tabs')
      openExternalUrl(url)
    })

  const setSync = useMutation({
    mutationFn: (v: { enabled: boolean; mode?: 'export' | 'two_way' }) =>
      api.post<SheetSyncStatus>(`/projects/${projectId}/sheets/sync`, { enabled: v.enabled, mode: v.mode ?? 'export' }),
    onSuccess: (status, v) => {
      toast.success(
        !v.enabled
          ? 'Live sync disabled'
          : v.mode === 'two_way'
            ? 'Two-way sync enabled — sheet edits flow back into FlowDesk'
            : 'Live sync enabled — updates every 10 minutes',
      )
      void queryClient.invalidateQueries({ queryKey: ['sheet-sync', projectId] })
      if (v.enabled && status.url) openExternalUrl(status.url)
    },
    onError: (err) => toast.error(errorMessage(err)),
  })

  const status = sync.data
  const enabled = status?.enabled ?? false

  return (
    <Modal open={open} onClose={onClose} title="Google Sheets" width="max-w-md">
      <div className="space-y-4">
        <p className="text-xs text-fg-muted">
          Export this project's tasks to a Google Sheet, or keep a sheet in sync.
        </p>

        {status?.url && (
          <button
            className="flex w-full items-center gap-2 rounded-lg border border-ink-700 bg-ink-900/50 px-3 py-2 text-left text-sm text-fg transition-colors hover:bg-ink-800"
            onClick={() => openExternalUrl(status.url)}
          >
            <FileSpreadsheet size={15} className="shrink-0 text-emerald-400" />
            <span className="min-w-0 flex-1 truncate">Open connected sheet</span>
            <ExternalLink size={13} className="shrink-0 text-fg-muted" />
          </button>
        )}

        <div className="space-y-2">
          <button className="btn-secondary w-full justify-start" disabled={busy} onClick={exportNow}>
            <FileSpreadsheet size={15} /> Export tasks to a new sheet
          </button>
          <button className="btn-secondary w-full justify-start" disabled={busy} onClick={exportTimeReport}>
            <Clock4 size={15} /> Export time report
          </button>
        </div>

        {canManage && (
          <div className="rounded-xl border border-ink-700 bg-ink-900/50 p-3">
            <div className="mb-2 flex items-center gap-2">
              <RefreshCw size={14} className="text-brand" />
              <p className="text-xs font-semibold uppercase tracking-wider text-fg-muted">Live sync</p>
            </div>
            {enabled ? (
              <div className="space-y-2">
                <p className="text-xs text-fg-secondary">
                  {status?.mode === 'two_way'
                    ? 'Two-way — sheet edits flow back into FlowDesk.'
                    : 'One-way — FlowDesk updates the sheet every 10 minutes.'}
                </p>
                <button
                  className="btn-ghost w-full justify-center !py-1.5 text-xs text-rose-400 hover:text-rose-300"
                  disabled={setSync.isPending}
                  onClick={() => setSync.mutate({ enabled: false })}
                >
                  Disable live sync
                </button>
              </div>
            ) : (
              <div className="flex gap-2">
                <button
                  className="btn-secondary flex-1 justify-center !py-1.5 text-xs"
                  disabled={setSync.isPending}
                  onClick={() => setSync.mutate({ enabled: true, mode: 'export' })}
                >
                  One-way
                </button>
                <button
                  className="btn-primary flex-1 justify-center !py-1.5 text-xs"
                  disabled={setSync.isPending}
                  onClick={() => setSync.mutate({ enabled: true, mode: 'two_way' })}
                >
                  Two-way
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    </Modal>
  )
}
