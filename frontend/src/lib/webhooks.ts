/** Outbound webhook types, health derivation, and helpers. No secrets stored here. */

export const WEBHOOK_VALID_EVENTS = [
  { id: 'task.created', label: 'Task created' },
  { id: 'task.updated', label: 'Task updated' },
  { id: 'task.deleted', label: 'Task deleted' },
  { id: 'task.assigned', label: 'Task assigned' },
  { id: 'status.changed', label: 'Status changed' },
  { id: 'comment.added', label: 'Comment added' },
  { id: 'project.created', label: 'Project created' },
  { id: 'project.updated', label: 'Project updated' },
  { id: 'project.archived', label: 'Project archived' },
  { id: 'sprint.started', label: 'Sprint started' },
  { id: 'sprint.completed', label: 'Sprint completed' },
  { id: '*', label: 'All events' },
] as const

export type WebhookDeliveryStatus = 'pending' | 'retrying' | 'success' | 'failed'

export type WebhookEndpointHealth =
  | 'active'
  | 'failing'
  | 'auto_disabled'
  | 'manually_disabled'

export interface WebhookEndpoint {
  id: string
  organization_id: string
  url: string
  description: string | null
  secret_prefix: string
  events: string[]
  is_active: boolean
  failure_count: number
  disabled_at: string | null
  disabled_reason: string | null
  previous_secret_expires_at: string | null
  last_delivered_at: string | null
  created_at: string
}

export interface WebhookEndpointCreated extends WebhookEndpoint {
  secret: string
}

export interface WebhookDelivery {
  id: string
  endpoint_id: string
  event_type: string
  idempotency_key: string
  status: WebhookDeliveryStatus | string
  request_payload: Record<string, unknown>
  response_status: number | null
  response_body: string | null
  duration_ms: number | null
  attempt: number
  max_attempts: number
  next_retry_at: string | null
  api_version: string
  redelivered_from_id: string | null
  error_message: string | null
  delivered_at: string | null
  created_at: string
  updated_at: string
}

export interface WebhookTestResult {
  success: boolean
  response_status?: number | null
  duration_ms?: number | null
  error?: string | null
}

export function deriveEndpointHealth(endpoint: WebhookEndpoint): WebhookEndpointHealth {
  if (!endpoint.is_active) {
    if (endpoint.disabled_reason === 'auto_failures') return 'auto_disabled'
    return 'manually_disabled'
  }
  if (endpoint.failure_count > 0) return 'failing'
  return 'active'
}

export function endpointHealthLabel(health: WebhookEndpointHealth): string {
  switch (health) {
    case 'active':
      return 'Active'
    case 'failing':
      return 'Failing'
    case 'auto_disabled':
      return 'Auto-disabled'
    case 'manually_disabled':
      return 'Disabled'
  }
}

export function deliveryStatusLabel(status: string): string {
  switch (status) {
    case 'pending':
      return 'Pending'
    case 'retrying':
      return 'Retrying'
    case 'success':
      return 'Success'
    case 'failed':
      return 'Failed'
    default:
      return status
  }
}

export function isInFlightDelivery(status: string): boolean {
  return status === 'pending' || status === 'retrying'
}

export function canRedeliver(status: string): boolean {
  return status === 'failed' || status === 'pending' || status === 'retrying'
}

export function truncateUrl(url: string, max = 48): string {
  if (url.length <= max) return url
  return `${url.slice(0, max - 1)}…`
}
