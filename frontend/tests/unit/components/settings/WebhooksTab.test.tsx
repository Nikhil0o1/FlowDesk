import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { WebhooksTab } from '@/components/settings/WebhooksTab'
import { api } from '@/lib/api'
import type { WebhookEndpoint } from '@/lib/webhooks'
import { useAuthStore } from '@/stores/auth'
import { mockUser } from '@tests/fixtures'
import { renderWithProviders } from '@tests/renderWithProviders'

function makeEndpoint(overrides: Partial<WebhookEndpoint> = {}): WebhookEndpoint {
  return {
    id: 'wh-1',
    organization_id: 'org-1',
    url: 'https://hooks.example.com/flowdesk',
    description: 'Prod sync',
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

describe('WebhooksTab', () => {
  beforeEach(() => {
    useAuthStore.setState({
      user: mockUser,
      loginContext: null,
      initialized: true,
      accessToken: 'jwt-token',
    })
    vi.mocked(api.get).mockReset()
    vi.mocked(api.post).mockReset()
    vi.mocked(api.patch).mockReset()
    vi.mocked(api.delete).mockReset()
  })

  it('renders empty state', async () => {
    vi.mocked(api.get).mockResolvedValue([])
    renderWithProviders(<WebhooksTab />)
    expect(await screen.findByText(/No webhook endpoints yet/i)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /Developer docs/i })).toHaveAttribute(
      'href',
      '/app/developers/webhooks',
    )
  })

  it('shows auto-disabled banner and re-enable', async () => {
    const user = userEvent.setup()
    vi.mocked(api.get).mockResolvedValue([
      makeEndpoint({
        is_active: false,
        disabled_reason: 'auto_failures',
        failure_count: 10,
        disabled_at: '2026-07-01T00:00:00Z',
      }),
    ])
    vi.mocked(api.patch).mockResolvedValue(
      makeEndpoint({ is_active: true, failure_count: 0, disabled_reason: null }),
    )

    renderWithProviders(<WebhooksTab />)
    expect(await screen.findByText(/Auto-disabled after 10 consecutive failures/i)).toBeInTheDocument()
    expect(screen.getByText('Auto-disabled')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /Re-enable/i }))
    await waitFor(() => {
      expect(api.patch).toHaveBeenCalledWith(
        expect.stringContaining('/webhooks/wh-1'),
        { is_active: true },
      )
    })
  })

  it('lists deliveries with redeliver and pagination controls', async () => {
    const user = userEvent.setup()
    vi.mocked(api.get).mockImplementation(async (url: string) => {
      if (url.includes('/deliveries')) {
        return {
          items: [
            {
              id: 'del-1',
              endpoint_id: 'wh-1',
              event_type: 'task.created',
              idempotency_key: 'idem-1',
              status: 'failed',
              request_payload: { event: 'task.created' },
              response_status: 500,
              response_body: 'err',
              duration_ms: 12,
              attempt: 6,
              max_attempts: 6,
              next_retry_at: null,
              api_version: '2026-07-14',
              redelivered_from_id: null,
              error_message: 'HTTP 500',
              delivered_at: null,
              created_at: '2026-07-01T00:00:00Z',
              updated_at: '2026-07-01T00:00:00Z',
            },
          ],
          total: 30,
          page: 1,
          page_size: 25,
        }
      }
      return [makeEndpoint()]
    })
    vi.mocked(api.post).mockResolvedValue({
      id: 'del-2',
      endpoint_id: 'wh-1',
      event_type: 'task.created',
      idempotency_key: 'idem-2',
      status: 'pending',
      request_payload: {},
      response_status: null,
      response_body: null,
      duration_ms: null,
      attempt: 1,
      max_attempts: 6,
      next_retry_at: null,
      api_version: '2026-07-14',
      redelivered_from_id: 'del-1',
      error_message: null,
      delivered_at: null,
      created_at: '2026-07-02T00:00:00Z',
      updated_at: '2026-07-02T00:00:00Z',
    })

    renderWithProviders(<WebhooksTab />)
    expect(await screen.findByText(/hooks.example.com/i)).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /Deliveries/i }))
    expect(await screen.findByText('Failed')).toBeInTheDocument()
    expect(screen.getByText(/Page 1 of 2/i)).toBeInTheDocument()

    await user.click(screen.getByTitle('Redeliver'))
    await waitFor(() => {
      expect(api.post).toHaveBeenCalledWith(
        expect.stringContaining('/deliveries/del-1/redeliver'),
      )
    })
  })
})
