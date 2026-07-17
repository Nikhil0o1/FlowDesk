import { screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { ApiKeyUsagePanel } from '@/components/settings/apiKeys/ApiKeyUsagePanel'
import { api, ApiError } from '@/lib/api'
import type { ApiToken, ApiTokenUsage } from '@/lib/apiKeys'
import { renderWithProviders } from '@tests/renderWithProviders'

const token: ApiToken = {
  id: 'tok-1',
  name: 'Reporting integration',
  token_prefix: 'fd_live_',
  scopes: ['tasks:read'],
  expires_at: '2030-01-01T00:00:00Z',
  last_used_at: '2026-07-14T10:00:00Z',
  revoked_at: null,
  revoke_at: null,
  created_at: '2026-07-02T00:00:00Z',
  display_suffix: 'abcd',
  environment: 'live',
  public_key_id: 'pk_abc',
  rotated_from_id: null,
}

const usage: ApiTokenUsage = {
  token_id: 'tok-1',
  window: '24h',
  requests_24h: 4281,
  errors_24h: 17,
  rate_limited_24h: 0,
  top_endpoint: '/api/v1/projects/{project_id}/tasks',
  last_used_at: '2026-07-14T10:00:00Z',
  last_success_at: '2026-07-14T10:00:00Z',
  last_success_route: '/api/v1/auth/me',
  last_fail_at: '2026-07-14T09:00:00Z',
  last_fail_route: '/api/v1/organizations',
  last_fail_status: 403,
  last_ip: '203.0.113.10',
  status: 'healthy',
  metrics_available: true,
  activity: [
    { at: '2026-07-14T10:00:00Z', event: 'used', detail: '200 /api/v1/auth/me' },
    { at: '2026-07-14T09:00:00Z', event: 'failed', detail: '403 /api/v1/organizations' },
    { at: '2026-07-02T00:00:00Z', event: 'created', detail: null },
  ],
}

describe('ApiKeyUsagePanel', () => {
  beforeEach(() => {
    vi.mocked(api.get).mockReset()
  })

  it('renders counts, status, and timeline without secrets', async () => {
    vi.mocked(api.get).mockResolvedValue(usage)
    renderWithProviders(<ApiKeyUsagePanel token={token} />)

    expect(await screen.findByText('4281')).toBeInTheDocument()
    expect(screen.getByText('17')).toBeInTheDocument()
    expect(screen.getByText('Healthy')).toBeInTheDocument()
    expect(screen.getByText('/projects/{project_id}/tasks')).toBeInTheDocument()
    expect(screen.getByText('Last successful request')).toBeInTheDocument()
    expect(screen.getByText('Last failed request')).toBeInTheDocument()
    expect(screen.getByText('203.0.113.10')).toBeInTheDocument()
    expect(screen.getByText('Used')).toBeInTheDocument()
    expect(screen.getByText('Failed')).toBeInTheDocument()
    expect(screen.getByText('Created')).toBeInTheDocument()
    expect(JSON.stringify(usage)).not.toMatch(/fd_live_pk_.*_[a-z0-9]{20}/i)
  })

  it('shows metrics unavailable honestly', async () => {
    vi.mocked(api.get).mockResolvedValue({
      ...usage,
      metrics_available: false,
      requests_24h: 0,
      status: 'idle',
    })
    renderWithProviders(<ApiKeyUsagePanel token={token} />)
    expect(await screen.findByText(/Usage metrics require Redis/i)).toBeInTheDocument()
    expect(screen.getByText('Idle')).toBeInTheDocument()
  })

  it('shows failing status', async () => {
    vi.mocked(api.get).mockResolvedValue({ ...usage, status: 'failing' })
    renderWithProviders(<ApiKeyUsagePanel token={token} />)
    expect(await screen.findByText('Failing')).toBeInTheDocument()
  })

  it('shows recoverable error', async () => {
    vi.mocked(api.get).mockRejectedValue(new ApiError(500, 'boom'))
    renderWithProviders(<ApiKeyUsagePanel token={token} />)
    expect(await screen.findByText(/Could not load usage/i)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Retry/i })).toBeInTheDocument()
  })
})
