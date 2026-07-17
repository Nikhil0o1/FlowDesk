import { Route, Routes } from 'react-router-dom'
import { screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { api } from '@/lib/api'
import type { ApiTokenMeta } from '@/lib/apiKeys'
import DeveloperDocsPage from '@/modules/developerDocs/DeveloperDocsPage'
import { EXAMPLES } from '@/modules/developerDocs/examples'
import { DOCS_NAV } from '@/modules/developerDocs/nav'
import { renderWithProviders } from '@tests/renderWithProviders'

const meta: ApiTokenMeta = {
  scopes: [
    {
      scope: 'tasks:read',
      group: 'Tasks',
      name: 'Read tasks',
      description: 'View tasks you can access',
      access: 'read',
    },
    {
      scope: 'tasks:write',
      group: 'Tasks',
      name: 'Write tasks',
      description: 'Does not allow reading unless tasks:read is also granted',
      access: 'write',
    },
  ],
  max_lifetime_days: 365,
  rotation_grace_seconds: 300,
  resource_restrictions_supported: false,
  identity_model: 'user_bound',
  api_version: '1.0.0',
  base_path: '/api/v1',
  rate_limits: [
    { category: 'standard', limit: 120, window_seconds: 60, algorithm: 'fixed_window' },
    { category: 'expensive_read', limit: 30, window_seconds: 60, algorithm: 'fixed_window' },
  ],
  public_routes: [
    {
      methods: ['GET'],
      path: '/api/v1/auth/me',
      scopes: ['profile:read'],
      rate_category: 'standard',
      authz_class: 'principal',
      tenant_resolution: '',
    },
  ],
}

function renderDocs(path: string) {
  return renderWithProviders(
    <Routes>
      <Route path="/app/developers/:slug" element={<DeveloperDocsPage />} />
    </Routes>,
    { routerProps: { initialEntries: [path] } },
  )
}

describe('DeveloperDocsPage', () => {
  beforeEach(() => {
    vi.mocked(api.get).mockResolvedValue(meta)
  })

  it('renders overview with honest limitations', async () => {
    renderDocs('/app/developers/overview')
    expect(await screen.findByRole('heading', { name: 'FlowDesk API' })).toBeInTheDocument()
    expect(screen.getByText(/Resource-specific restrictions are not available yet/i)).toBeInTheDocument()
    expect(screen.getByText(/Organization service accounts are not supported/i)).toBeInTheDocument()
    expect(screen.queryByText(/organization API key/i)).not.toBeInTheDocument()
  })

  it('shows scopes from meta with write≠read copy', async () => {
    renderDocs('/app/developers/scopes')
    expect(await screen.findByText('tasks:read')).toBeInTheDocument()
    expect(screen.getByText('tasks:write')).toBeInTheDocument()
    expect(screen.getByText(/Does not allow reading unless tasks:read/i)).toBeInTheDocument()
    expect(screen.getByText(/Scopes are not restricted to individual workspaces/i)).toBeInTheDocument()
  })

  it('renders rate limits from backend meta', async () => {
    renderDocs('/app/developers/rate-limits')
    expect(await screen.findByText('standard')).toBeInTheDocument()
    expect(screen.getByText('120')).toBeInTheDocument()
    expect(screen.getAllByText('fixed_window').length).toBeGreaterThan(0)
  })

  it('lists only public routes in API reference', async () => {
    renderDocs('/app/developers/api-reference')
    expect(await screen.findByText('/auth/me')).toBeInTheDocument()
    expect(screen.getByText('profile:read')).toBeInTheDocument()
    expect(screen.queryByText(/\/admin/)).not.toBeInTheDocument()
  })

  it('documents stable error codes', async () => {
    renderDocs('/app/developers/errors')
    expect(await screen.findByText(/401 invalid_credentials/i)).toBeInTheDocument()
    expect(screen.getByText(/403 insufficient_scope/i)).toBeInTheDocument()
    expect(screen.getByText(/403 pat_not_allowed/i)).toBeInTheDocument()
    expect(screen.getByText(/429 rate_limited/i)).toBeInTheDocument()
  })
})

describe('developer docs examples', () => {
  it('uses env placeholders and never embeds a live-looking secret', () => {
    const blobs = [
      EXAMPLES.curlAuthMe('/api/v1'),
      EXAMPLES.jsAuthMe('/api/v1'),
      EXAMPLES.pyAuthMe('/api/v1'),
      EXAMPLES.curlCreateTask('/api/v1'),
    ].join('\n')
    expect(blobs).toContain('FLOWDESK_API_KEY')
    expect(blobs).not.toMatch(/fd_live_[a-zA-Z0-9]+_[a-zA-Z0-9]{20,}/)
    expect(blobs).not.toContain('verify=False')
  })

  it('nav covers required sections', () => {
    const slugs = DOCS_NAV.map((n) => n.slug)
    for (const required of [
      'overview',
      'quickstart',
      'authentication',
      'scopes',
      'api-reference',
      'errors',
      'rate-limits',
      'examples',
      'versioning',
      'webhooks',
      'realtime',
      'key-rotation',
    ]) {
      expect(slugs).toContain(required)
    }
  })
})
