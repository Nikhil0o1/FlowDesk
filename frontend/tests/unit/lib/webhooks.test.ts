import { describe, expect, it } from 'vitest'

import {
  canRedeliver,
  deliveryStatusLabel,
  deriveEndpointHealth,
  endpointHealthLabel,
  isInFlightDelivery,
  truncateUrl,
  type WebhookEndpoint,
} from '@/lib/webhooks'

function endpoint(overrides: Partial<WebhookEndpoint> = {}): WebhookEndpoint {
  return {
    id: 'wh-1',
    organization_id: 'org-1',
    url: 'https://example.com/hooks/flowdesk',
    description: null,
    secret_prefix: 'whsec_abcd',
    events: ['task.created'],
    is_active: true,
    failure_count: 0,
    disabled_at: null,
    disabled_reason: null,
    previous_secret_expires_at: null,
    last_delivered_at: null,
    created_at: '2026-01-01T00:00:00Z',
    ...overrides,
  }
}

describe('deriveEndpointHealth', () => {
  it('returns active when healthy', () => {
    expect(deriveEndpointHealth(endpoint())).toBe('active')
  })

  it('returns failing when active with failures', () => {
    expect(deriveEndpointHealth(endpoint({ failure_count: 2 }))).toBe('failing')
  })

  it('returns auto_disabled when disabled_reason is auto_failures', () => {
    expect(
      deriveEndpointHealth(
        endpoint({
          is_active: false,
          disabled_reason: 'auto_failures',
          failure_count: 10,
          disabled_at: '2026-07-01T00:00:00Z',
        }),
      ),
    ).toBe('auto_disabled')
  })

  it('returns manually_disabled otherwise', () => {
    expect(
      deriveEndpointHealth(endpoint({ is_active: false, disabled_reason: 'manual' })),
    ).toBe('manually_disabled')
  })

  it('labels health for UI', () => {
    expect(endpointHealthLabel('auto_disabled')).toBe('Auto-disabled')
    expect(endpointHealthLabel('failing')).toBe('Failing')
  })
})

describe('delivery helpers', () => {
  it('labels statuses', () => {
    expect(deliveryStatusLabel('retrying')).toBe('Retrying')
    expect(deliveryStatusLabel('failed')).toBe('Failed')
  })

  it('detects in-flight deliveries', () => {
    expect(isInFlightDelivery('pending')).toBe(true)
    expect(isInFlightDelivery('retrying')).toBe(true)
    expect(isInFlightDelivery('failed')).toBe(false)
  })

  it('allows redeliver for non-success', () => {
    expect(canRedeliver('failed')).toBe(true)
    expect(canRedeliver('success')).toBe(false)
  })

  it('truncates long urls', () => {
    const long = `https://example.com/${'x'.repeat(80)}`
    expect(truncateUrl(long, 40).endsWith('…')).toBe(true)
    expect(truncateUrl('https://ok.com', 40)).toBe('https://ok.com')
  })
})
