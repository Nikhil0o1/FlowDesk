import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  Check,
  ChevronDown,
  ChevronRight,
  Copy,
  ExternalLink,
  Loader2,
  Play,
  Plus,
  RefreshCw,
  RotateCcw,
  Trash2,
  Webhook,
} from 'lucide-react'
import { useState } from 'react'
import { Link } from 'react-router-dom'

import { api, errorMessage } from '../../lib/api'
import { useCurrentContext } from '../../lib/queries'
import type { Page } from '../../lib/types'
import { cn, formatDateTime } from '../../lib/utils'
import {
  WEBHOOK_VALID_EVENTS,
  deliveryStatusLabel,
  deriveEndpointHealth,
  endpointHealthLabel,
  isInFlightDelivery,
  truncateUrl,
  type WebhookDelivery,
  type WebhookEndpoint,
  type WebhookEndpointCreated,
  type WebhookTestResult,
} from '../../lib/webhooks'
import { toast } from '../../stores/toast'
import { Modal } from '../ui/Modal'
import { CenteredSpinner } from '../ui/Spinner'

function SecretDialog({
  secret,
  onClose,
}: {
  secret: string
  onClose: () => void
}) {
  const [copied, setCopied] = useState(false)

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(secret)
      setCopied(true)
      toast.success('Signing secret copied')
      setTimeout(() => setCopied(false), 2000)
    } catch {
      toast.error('Could not copy to clipboard')
    }
  }

  return (
    <Modal open title="Save your signing secret" onClose={onClose} width="max-w-md">
      <p className="text-sm text-fg-secondary">
        Copy this secret now. It will not be shown again — use it to verify{' '}
        <code className="rounded bg-ink-800 px-1 py-0.5 text-xs">X-FlowDesk-Signature</code>{' '}
        (Stripe-style <code className="rounded bg-ink-800 px-1 py-0.5 text-xs">t=,v1=</code>).
      </p>
      <div className="mt-4 flex items-center gap-2 rounded-lg border border-ink-700 bg-ink-900 p-3">
        <code className="flex-1 break-all font-mono text-xs text-fg">{secret}</code>
        <button type="button" className="btn-ghost shrink-0 p-2" onClick={copy} title="Copy secret">
          {copied ? <Check size={16} className="text-emerald-400" /> : <Copy size={16} />}
        </button>
      </div>
      <button type="button" className="btn-primary mt-4 w-full" onClick={onClose}>
        I&apos;ve saved the secret
      </button>
    </Modal>
  )
}

function EventCheckboxes({
  selected,
  onChange,
}: {
  selected: string[]
  onChange: (events: string[]) => void
}) {
  const toggle = (eventId: string) => {
    if (eventId === '*') {
      onChange(['*'])
      return
    }
    const withoutWildcard = selected.filter((e) => e !== '*')
    if (withoutWildcard.includes(eventId)) {
      onChange(withoutWildcard.filter((e) => e !== eventId))
    } else {
      onChange([...withoutWildcard, eventId])
    }
  }

  return (
    <div className="grid gap-1.5 sm:grid-cols-2">
      {WEBHOOK_VALID_EVENTS.map((ev) => (
        <label
          key={ev.id}
          className={cn(
            'flex cursor-pointer items-center gap-2 rounded-lg border px-3 py-2 text-xs transition-colors',
            selected.includes(ev.id) || (ev.id !== '*' && selected.includes('*'))
              ? 'border-brand/40 bg-brand-soft/30 text-fg'
              : 'border-ink-700 bg-ink-900 text-fg-secondary hover:border-ink-600',
          )}
        >
          <input
            type="checkbox"
            className="rounded border-ink-600"
            checked={selected.includes(ev.id) || (ev.id !== '*' && selected.includes('*'))}
            disabled={ev.id !== '*' && selected.includes('*')}
            onChange={() => toggle(ev.id)}
          />
          {ev.label}
        </label>
      ))}
    </div>
  )
}

function HealthBadge({ endpoint }: { endpoint: WebhookEndpoint }) {
  const health = deriveEndpointHealth(endpoint)
  return (
    <span
      className={cn(
        'rounded-full px-2 py-0.5 text-[10px] font-medium',
        health === 'active' && 'bg-emerald-500/10 text-emerald-400',
        health === 'failing' && 'bg-amber-500/10 text-amber-400',
        health === 'auto_disabled' && 'bg-red-500/10 text-red-400',
        health === 'manually_disabled' && 'bg-ink-700 text-fg-muted',
      )}
    >
      {endpointHealthLabel(health)}
    </span>
  )
}

export function WebhooksTab() {
  const { org } = useCurrentContext()
  const queryClient = useQueryClient()
  const orgId = org?.id

  const [createOpen, setCreateOpen] = useState(false)
  const [editTarget, setEditTarget] = useState<WebhookEndpoint | null>(null)
  const [deliveriesTarget, setDeliveriesTarget] = useState<WebhookEndpoint | null>(null)
  const [deliveryPage, setDeliveryPage] = useState(1)
  const [pendingSecret, setPendingSecret] = useState<string | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<WebhookEndpoint | null>(null)
  const [rotateConfirm, setRotateConfirm] = useState<WebhookEndpoint | null>(null)
  const [testingId, setTestingId] = useState<string | null>(null)
  const [rotatingId, setRotatingId] = useState<string | null>(null)
  const [redeliveringId, setRedeliveringId] = useState<string | null>(null)

  const [formUrl, setFormUrl] = useState('')
  const [formDescription, setFormDescription] = useState('')
  const [formEvents, setFormEvents] = useState<string[]>(['task.created', 'task.updated'])
  const [formActive, setFormActive] = useState(true)

  const endpoints = useQuery({
    queryKey: ['webhooks', orgId],
    queryFn: () => api.get<WebhookEndpoint[]>(`/organizations/${orgId}/webhooks`),
    enabled: !!orgId,
  })

  const deliveries = useQuery({
    queryKey: ['webhook-deliveries', orgId, deliveriesTarget?.id, deliveryPage],
    queryFn: () =>
      api.get<Page<WebhookDelivery>>(
        `/organizations/${orgId}/webhooks/${deliveriesTarget!.id}/deliveries?page=${deliveryPage}&page_size=25`,
      ),
    enabled: !!orgId && !!deliveriesTarget,
    refetchInterval: (query) => {
      const rows = query.state.data?.items ?? []
      return rows.some((d) => isInFlightDelivery(d.status)) ? 4000 : false
    },
  })

  const resetForm = () => {
    setFormUrl('')
    setFormDescription('')
    setFormEvents(['task.created', 'task.updated'])
    setFormActive(true)
  }

  const create = useMutation({
    mutationFn: () =>
      api.post<WebhookEndpointCreated>(`/organizations/${orgId}/webhooks`, {
        url: formUrl.trim(),
        events: formEvents,
        description: formDescription.trim() || null,
      }),
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['webhooks', orgId] })
      setCreateOpen(false)
      resetForm()
      setPendingSecret(data.secret)
      toast.success('Webhook endpoint created')
    },
    onError: (err) => toast.error(errorMessage(err)),
  })

  const update = useMutation({
    mutationFn: () =>
      api.patch<WebhookEndpoint>(`/organizations/${orgId}/webhooks/${editTarget!.id}`, {
        url: formUrl.trim(),
        events: formEvents,
        description: formDescription.trim() || null,
        is_active: formActive,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['webhooks', orgId] })
      setEditTarget(null)
      resetForm()
      toast.success('Webhook updated')
    },
    onError: (err) => toast.error(errorMessage(err)),
  })

  const reEnable = useMutation({
    mutationFn: (id: string) =>
      api.patch<WebhookEndpoint>(`/organizations/${orgId}/webhooks/${id}`, { is_active: true }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['webhooks', orgId] })
      toast.success('Webhook re-enabled')
    },
    onError: (err) => toast.error(errorMessage(err)),
  })

  const remove = useMutation({
    mutationFn: (id: string) => api.delete(`/organizations/${orgId}/webhooks/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['webhooks', orgId] })
      setDeleteTarget(null)
      if (deliveriesTarget?.id === deleteTarget?.id) setDeliveriesTarget(null)
      toast.success('Webhook deleted')
    },
    onError: (err) => toast.error(errorMessage(err)),
  })

  const rotate = useMutation({
    mutationFn: (id: string) =>
      api.post<WebhookEndpointCreated>(`/organizations/${orgId}/webhooks/${id}/rotate-secret`),
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['webhooks', orgId] })
      setRotatingId(null)
      setRotateConfirm(null)
      setPendingSecret(data.secret)
      toast.success('Signing secret rotated')
    },
    onError: (err) => {
      setRotatingId(null)
      toast.error(errorMessage(err))
    },
  })

  const test = useMutation({
    mutationFn: (id: string) =>
      api.post<WebhookTestResult>(`/organizations/${orgId}/webhooks/${id}/test`),
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ['webhook-deliveries', orgId] })
      if (result.success) {
        toast.success(`Test delivered (${result.response_status}, ${result.duration_ms}ms)`)
      } else {
        toast.error(result.error || `Test failed (${result.response_status ?? 'no response'})`)
      }
    },
    onError: (err) => toast.error(errorMessage(err)),
    onSettled: () => setTestingId(null),
  })

  const redeliver = useMutation({
    mutationFn: ({ endpointId, deliveryId }: { endpointId: string; deliveryId: string }) =>
      api.post<WebhookDelivery>(
        `/organizations/${orgId}/webhooks/${endpointId}/deliveries/${deliveryId}/redeliver`,
      ),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['webhook-deliveries', orgId] })
      toast.success('Redelivery queued')
    },
    onError: (err) => toast.error(errorMessage(err)),
    onSettled: () => setRedeliveringId(null),
  })

  const openEdit = (endpoint: WebhookEndpoint) => {
    setFormUrl(endpoint.url)
    setFormDescription(endpoint.description || '')
    setFormEvents(endpoint.events)
    setFormActive(endpoint.is_active)
    setEditTarget(endpoint)
  }

  if (endpoints.isLoading) return <CenteredSpinner className="py-16" />

  if (endpoints.isError) {
    return (
      <div className="rounded-xl border border-red-500/30 bg-red-500/5 px-4 py-6 text-center">
        <p className="text-sm text-red-400">{errorMessage(endpoints.error)}</p>
      </div>
    )
  }

  const items = endpoints.data ?? []
  const totalDeliveries = deliveries.data?.total ?? 0
  const pageSize = deliveries.data?.page_size ?? 25
  const totalPages = Math.max(1, Math.ceil(totalDeliveries / pageSize))

  return (
    <div className="space-y-6">
      <section className="flex flex-wrap items-start justify-between gap-3">
        <div className="max-w-2xl space-y-1">
          <h3 className="text-sm font-semibold text-fg">Outbound webhooks</h3>
          <p className="text-sm leading-relaxed text-fg-muted">
            Push signed JSON events to external systems when tasks, projects, comments, or sprints
            change. Verify deliveries with the HMAC signature in{' '}
            <code className="rounded bg-ink-800 px-1 text-[10px]">X-FlowDesk-Signature</code>.{' '}
            <Link
              to="/app/developers/webhooks"
              className="inline-flex items-center gap-0.5 text-brand hover:underline"
            >
              Developer docs
              <ExternalLink size={10} />
            </Link>
          </p>
        </div>
        <button
          type="button"
          className="btn-primary inline-flex items-center gap-1.5 text-xs"
          onClick={() => {
            resetForm()
            setCreateOpen(true)
          }}
        >
          <Plus size={14} />
          Add endpoint
        </button>
      </section>

      <div className="overflow-hidden rounded-xl border border-ink-700">
        {items.length === 0 ? (
          <div className="flex flex-col items-center gap-2 bg-ink-900 px-6 py-12 text-center">
            <Webhook size={28} className="text-fg-muted" />
            <p className="text-sm text-fg-secondary">No webhook endpoints yet</p>
            <p className="max-w-sm text-xs text-fg-muted">
              Register a URL to receive real-time event notifications from FlowDesk.
            </p>
          </div>
        ) : (
          items.map((endpoint) => {
            const health = deriveEndpointHealth(endpoint)
            return (
              <div
                key={endpoint.id}
                className="border-b border-ink-700/60 bg-ink-900 px-4 py-3 last:border-b-0"
              >
                {health === 'auto_disabled' && (
                  <div className="mb-3 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2">
                    <p className="text-xs text-amber-950 dark:text-amber-100">
                      Auto-disabled after {endpoint.failure_count} consecutive failures
                      {endpoint.disabled_at
                        ? ` on ${formatDateTime(endpoint.disabled_at)}`
                        : ''}
                      . Fix your receiver, then re-enable to reset the failure streak.
                    </p>
                    <button
                      type="button"
                      className="btn-primary shrink-0 px-2 py-1 text-[11px]"
                      disabled={reEnable.isPending}
                      onClick={() => reEnable.mutate(endpoint.id)}
                    >
                      Re-enable
                    </button>
                  </div>
                )}
                <div className="flex flex-wrap items-start gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="truncate font-mono text-xs text-fg" title={endpoint.url}>
                        {truncateUrl(endpoint.url)}
                      </span>
                      <HealthBadge endpoint={endpoint} />
                      {endpoint.failure_count > 0 && endpoint.is_active && (
                        <span className="text-[10px] text-amber-400">
                          {endpoint.failure_count} failure
                          {endpoint.failure_count === 1 ? '' : 's'}
                        </span>
                      )}
                    </div>
                    {endpoint.description && (
                      <p className="mt-0.5 text-xs text-fg-muted">{endpoint.description}</p>
                    )}
                    <p className="mt-1 text-[11px] text-fg-muted">
                      Secret {endpoint.secret_prefix}… ·{' '}
                      {endpoint.events.includes('*') ? 'All events' : endpoint.events.join(', ')}
                      {endpoint.last_delivered_at && (
                        <> · Last delivered {formatDateTime(endpoint.last_delivered_at)}</>
                      )}
                    </p>
                  </div>
                  <div className="flex shrink-0 flex-wrap items-center gap-1">
                    <button
                      type="button"
                      className="btn-ghost px-2 py-1 text-[11px]"
                      disabled={testingId === endpoint.id}
                      onClick={() => {
                        setTestingId(endpoint.id)
                        test.mutate(endpoint.id)
                      }}
                    >
                      {testingId === endpoint.id ? (
                        <Loader2 size={13} className="animate-spin" />
                      ) : (
                        <Play size={13} />
                      )}
                      <span className="ml-1">Test</span>
                    </button>
                    <button
                      type="button"
                      className="btn-ghost px-2 py-1 text-[11px]"
                      onClick={() => {
                        if (deliveriesTarget?.id === endpoint.id) {
                          setDeliveriesTarget(null)
                        } else {
                          setDeliveryPage(1)
                          setDeliveriesTarget(endpoint)
                        }
                      }}
                    >
                      Deliveries
                      {deliveriesTarget?.id === endpoint.id ? (
                        <ChevronDown size={13} className="ml-0.5 inline" />
                      ) : (
                        <ChevronRight size={13} className="ml-0.5 inline" />
                      )}
                    </button>
                    <button
                      type="button"
                      className="btn-ghost px-2 py-1 text-[11px]"
                      onClick={() => setRotateConfirm(endpoint)}
                    >
                      <RefreshCw size={13} />
                      <span className="ml-1">Rotate</span>
                    </button>
                    <button
                      type="button"
                      className="btn-ghost px-2 py-1 text-[11px]"
                      onClick={() => openEdit(endpoint)}
                    >
                      Edit
                    </button>
                    <button
                      type="button"
                      className="btn-ghost px-2 py-1 text-[11px] text-red-400 hover:text-red-300"
                      onClick={() => setDeleteTarget(endpoint)}
                    >
                      <Trash2 size={13} />
                    </button>
                  </div>
                </div>

                {deliveriesTarget?.id === endpoint.id && (
                  <DeliveriesPanel
                    loading={deliveries.isLoading}
                    items={deliveries.data?.items ?? []}
                    page={deliveryPage}
                    totalPages={totalPages}
                    total={totalDeliveries}
                    onPageChange={setDeliveryPage}
                    redeliveringId={redeliveringId}
                    onRedeliver={(deliveryId) => {
                      setRedeliveringId(deliveryId)
                      redeliver.mutate({ endpointId: endpoint.id, deliveryId })
                    }}
                  />
                )}
              </div>
            )
          })
        )}
      </div>

      <Modal
        open={createOpen}
        title="Add webhook endpoint"
        onClose={() => setCreateOpen(false)}
        width="max-w-xl"
      >
        <WebhookForm
          url={formUrl}
          description={formDescription}
          events={formEvents}
          onUrlChange={setFormUrl}
          onDescriptionChange={setFormDescription}
          onEventsChange={setFormEvents}
        />
        <div className="mt-5 flex justify-end gap-2">
          <button type="button" className="btn-ghost" onClick={() => setCreateOpen(false)}>
            Cancel
          </button>
          <button
            type="button"
            className="btn-primary"
            disabled={!formUrl.trim() || formEvents.length === 0 || create.isPending}
            onClick={() => create.mutate()}
          >
            {create.isPending ? 'Creating…' : 'Create endpoint'}
          </button>
        </div>
      </Modal>

      <Modal
        open={!!editTarget}
        title="Edit webhook endpoint"
        onClose={() => setEditTarget(null)}
        width="max-w-xl"
      >
        <WebhookForm
          url={formUrl}
          description={formDescription}
          events={formEvents}
          active={formActive}
          showActive
          onUrlChange={setFormUrl}
          onDescriptionChange={setFormDescription}
          onEventsChange={setFormEvents}
          onActiveChange={setFormActive}
        />
        {editTarget && deriveEndpointHealth(editTarget) === 'auto_disabled' && formActive && (
          <p className="mt-3 text-xs text-amber-950 dark:text-amber-100">
            Re-enabling clears the failure streak and auto-disable marker.
          </p>
        )}
        <div className="mt-5 flex justify-end gap-2">
          <button type="button" className="btn-ghost" onClick={() => setEditTarget(null)}>
            Cancel
          </button>
          <button
            type="button"
            className="btn-primary"
            disabled={!formUrl.trim() || formEvents.length === 0 || update.isPending}
            onClick={() => update.mutate()}
          >
            {update.isPending ? 'Saving…' : 'Save changes'}
          </button>
        </div>
      </Modal>

      <Modal
        open={!!rotateConfirm}
        title="Rotate signing secret"
        onClose={() => setRotateConfirm(null)}
        width="max-w-md"
      >
        <p className="text-sm text-fg-secondary">
          Generate a new secret for{' '}
          <span className="font-mono text-fg">{rotateConfirm?.url}</span>? The previous secret
          remains valid for 24 hours (dual-sign grace) so receivers can update without downtime.
        </p>
        <div className="mt-5 flex justify-end gap-2">
          <button type="button" className="btn-ghost" onClick={() => setRotateConfirm(null)}>
            Cancel
          </button>
          <button
            type="button"
            className="btn-primary"
            disabled={rotate.isPending}
            onClick={() => {
              if (!rotateConfirm) return
              setRotatingId(rotateConfirm.id)
              rotate.mutate(rotateConfirm.id)
            }}
          >
            {rotatingId === rotateConfirm?.id && rotate.isPending ? 'Rotating…' : 'Rotate secret'}
          </button>
        </div>
      </Modal>

      <Modal
        open={!!deleteTarget}
        title="Delete webhook endpoint"
        onClose={() => setDeleteTarget(null)}
        width="max-w-md"
      >
        <p className="text-sm text-fg-secondary">
          Delete <span className="font-mono text-fg">{deleteTarget?.url}</span>? Delivery history
          will be removed and events will stop immediately.
        </p>
        <div className="mt-5 flex justify-end gap-2">
          <button type="button" className="btn-ghost" onClick={() => setDeleteTarget(null)}>
            Cancel
          </button>
          <button
            type="button"
            className="rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-500"
            disabled={remove.isPending}
            onClick={() => deleteTarget && remove.mutate(deleteTarget.id)}
          >
            {remove.isPending ? 'Deleting…' : 'Delete'}
          </button>
        </div>
      </Modal>

      {pendingSecret && (
        <SecretDialog secret={pendingSecret} onClose={() => setPendingSecret(null)} />
      )}
    </div>
  )
}

function WebhookForm({
  url,
  description,
  events,
  active,
  showActive,
  onUrlChange,
  onDescriptionChange,
  onEventsChange,
  onActiveChange,
}: {
  url: string
  description: string
  events: string[]
  active?: boolean
  showActive?: boolean
  onUrlChange: (v: string) => void
  onDescriptionChange: (v: string) => void
  onEventsChange: (events: string[]) => void
  onActiveChange?: (v: boolean) => void
}) {
  return (
    <div className="space-y-4">
      <label className="block">
        <span className="text-xs font-medium text-fg-secondary">Endpoint URL</span>
        <input
          type="url"
          className="input mt-1 w-full"
          placeholder="https://example.com/webhooks/flowdesk"
          value={url}
          onChange={(e) => onUrlChange(e.target.value)}
        />
        <p className="mt-1 text-[11px] text-fg-muted">
          Production requires HTTPS. Private/loopback URLs are blocked unless explicitly allowed in
          development.
        </p>
      </label>
      <label className="block">
        <span className="text-xs font-medium text-fg-secondary">Description (optional)</span>
        <input
          type="text"
          className="input mt-1 w-full"
          placeholder="BrightWorks production sync"
          value={description}
          onChange={(e) => onDescriptionChange(e.target.value)}
        />
      </label>
      <div>
        <span className="text-xs font-medium text-fg-secondary">Events</span>
        <div className="mt-2">
          <EventCheckboxes selected={events} onChange={onEventsChange} />
        </div>
      </div>
      {showActive && onActiveChange && (
        <label className="flex items-center gap-2 text-sm text-fg-secondary">
          <input
            type="checkbox"
            className="rounded border-ink-600"
            checked={active}
            onChange={(e) => onActiveChange(e.target.checked)}
          />
          Endpoint active
        </label>
      )}
    </div>
  )
}

function DeliveriesPanel({
  loading,
  items,
  page,
  totalPages,
  total,
  onPageChange,
  redeliveringId,
  onRedeliver,
}: {
  loading: boolean
  items: WebhookDelivery[]
  page: number
  totalPages: number
  total: number
  onPageChange: (page: number) => void
  redeliveringId: string | null
  onRedeliver: (deliveryId: string) => void
}) {
  const [expanded, setExpanded] = useState<string | null>(null)

  if (loading) return <CenteredSpinner className="py-6" />

  if (items.length === 0) {
    return (
      <p className="mt-3 rounded-lg border border-ink-700/60 bg-ink-850 px-3 py-4 text-center text-xs text-fg-muted">
        No deliveries yet. Use Test or trigger a subscribed event.
      </p>
    )
  }

  return (
    <div className="mt-3 space-y-2">
      <div className="overflow-hidden rounded-lg border border-ink-700/60 bg-ink-850">
        {items.map((d) => (
          <div key={d.id} className="border-b border-ink-700/40 last:border-b-0">
            <div className="flex items-center gap-1">
              <button
                type="button"
                className="flex min-w-0 flex-1 items-center gap-2 px-3 py-2 text-left text-xs hover:bg-ink-800/60"
                onClick={() => setExpanded(expanded === d.id ? null : d.id)}
              >
                <span
                  className={cn(
                    'rounded px-1.5 py-0.5 font-mono text-[10px]',
                    d.status === 'success' && 'bg-emerald-500/10 text-emerald-400',
                    d.status === 'pending' && 'bg-amber-500/10 text-amber-400',
                    d.status === 'retrying' && 'bg-sky-500/10 text-sky-400',
                    d.status === 'failed' && 'bg-red-500/10 text-red-400',
                  )}
                >
                  {deliveryStatusLabel(d.status)}
                </span>
                <span className="text-fg-secondary">{d.event_type}</span>
                <span className="text-fg-muted">
                  {d.attempt}/{d.max_attempts}
                  {d.duration_ms != null ? ` · ${d.duration_ms}ms` : ''}
                </span>
                <span className="truncate text-fg-muted">
                  {d.response_status != null ? `HTTP ${d.response_status}` : d.error_message || '—'}
                </span>
                <span className="ml-auto shrink-0 text-fg-muted">{formatDateTime(d.created_at)}</span>
                {expanded === d.id ? (
                  <ChevronDown size={12} className="shrink-0 text-fg-muted" />
                ) : (
                  <ChevronRight size={12} className="shrink-0 text-fg-muted" />
                )}
              </button>
              {d.status === 'failed' && (
                <button
                  type="button"
                  className="btn-ghost mr-2 shrink-0 px-2 py-1 text-[10px]"
                  disabled={redeliveringId === d.id}
                  title="Redeliver"
                  onClick={() => onRedeliver(d.id)}
                >
                  {redeliveringId === d.id ? (
                    <Loader2 size={12} className="animate-spin" />
                  ) : (
                    <RotateCcw size={12} />
                  )}
                </button>
              )}
            </div>
            {expanded === d.id && (
              <div className="space-y-2 border-t border-ink-700/40 bg-ink-900/80 px-3 py-2">
                <p className="font-mono text-[10px] text-fg-muted">
                  id={d.id} · idempotency={d.idempotency_key} · api={d.api_version}
                  {d.next_retry_at ? ` · next_retry=${formatDateTime(d.next_retry_at)}` : ''}
                  {d.redelivered_from_id ? ` · from=${d.redelivered_from_id}` : ''}
                </p>
                <pre className="max-h-32 overflow-auto rounded bg-ink-950 p-2 font-mono text-[10px] text-fg-muted">
                  {JSON.stringify(d.request_payload, null, 2)}
                </pre>
                {d.response_body && (
                  <pre className="max-h-24 overflow-auto rounded bg-ink-950 p-2 font-mono text-[10px] text-fg-muted">
                    {d.response_body}
                  </pre>
                )}
              </div>
            )}
          </div>
        ))}
      </div>
      {totalPages > 1 && (
        <div className="flex items-center justify-between px-1 text-[11px] text-fg-muted">
          <span>
            Page {page} of {totalPages} ({total} total)
          </span>
          <div className="flex gap-1">
            <button
              type="button"
              className="btn-ghost px-2 py-0.5"
              disabled={page <= 1}
              onClick={() => onPageChange(page - 1)}
            >
              Prev
            </button>
            <button
              type="button"
              className="btn-ghost px-2 py-0.5"
              disabled={page >= totalPages}
              onClick={() => onPageChange(page + 1)}
            >
              Next
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
