import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { PersonalApiKeysSection } from '@/components/settings/apiKeys/PersonalApiKeysSection'
import { api, ApiError } from '@/lib/api'
import type { ApiToken, ApiTokenCreated, ApiTokenMeta } from '@/lib/apiKeys'
import { useAuthStore } from '@/stores/auth'
import { mockUser } from '@tests/fixtures'
import { renderWithProviders } from '@tests/renderWithProviders'

const RAW_SECRET = 'fd_live_pk_abc123_supersecretvalueneverpersist'
const MASKED_SECRET = `${RAW_SECRET.slice(0, 8)}${'•'.repeat(24)}${RAW_SECRET.slice(-4)}`

const meta: ApiTokenMeta = {
  scopes: [
    {
      scope: 'profile:read',
      group: 'Identity',
      name: 'Read profile',
      description: 'Read your profile',
      access: 'read',
    },
    {
      scope: 'tasks:read',
      group: 'Tasks',
      name: 'Read tasks',
      description: 'View tasks',
      access: 'read',
    },
    {
      scope: 'tasks:write',
      group: 'Tasks',
      name: 'Write tasks',
      description: 'Modify tasks — does not include read',
      access: 'write',
    },
  ],
  max_lifetime_days: 365,
  rotation_grace_seconds: 300,
  resource_restrictions_supported: false,
  identity_model: 'user_bound',
}

function makeToken(overrides: Partial<ApiToken> = {}): ApiToken {
  return {
    id: 'tok-1',
    name: 'Reporting integration',
    token_prefix: 'fd_live_',
    scopes: ['tasks:read'],
    expires_at: '2030-01-01T00:00:00Z',
    last_used_at: null,
    revoked_at: null,
    revoke_at: null,
    created_at: '2026-01-01T00:00:00Z',
    display_suffix: 'wxyz',
    environment: 'live',
    public_key_id: 'pk_abc123',
    rotated_from_id: null,
    ...overrides,
  }
}

describe('PersonalApiKeysSection', () => {
  beforeEach(() => {
    useAuthStore.setState({
      user: mockUser,
      loginContext: null,
      initialized: true,
      accessToken: 'jwt-token',
    })
    vi.mocked(api.get).mockImplementation(async (url: string) => {
      if (url.includes('/meta')) return meta
      if (url.includes('/api-tokens')) return []
      return {}
    })
    vi.mocked(api.post).mockReset()
    vi.mocked(api.delete).mockReset()
    vi.mocked(api.patch).mockReset()
    localStorage.clear()
    sessionStorage.clear()
  })

  it('shows loading skeleton then empty state', async () => {
    let resolveList: (v: ApiToken[]) => void = () => {}
    vi.mocked(api.get).mockImplementation(async (url: string) => {
      if (url.includes('/meta')) return meta
      if (url.includes('/api-tokens')) {
        return new Promise<ApiToken[]>((resolve) => {
          resolveList = resolve
        })
      }
      return {}
    })

    renderWithProviders(<PersonalApiKeysSection />)
    expect(document.querySelector('.animate-pulse')).toBeTruthy()

    resolveList([])
    expect(await screen.findByText('No API keys yet')).toBeInTheDocument()
    expect(screen.getByText(/use Custom Apps \(OAuth\) instead/i)).toBeInTheDocument()
    expect(screen.queryByText(/workspace restriction/i)).not.toBeInTheDocument()
    expect(screen.queryByLabelText(/workspace/i)).not.toBeInTheDocument()
    expect(screen.queryByLabelText(/project restriction/i)).not.toBeInTheDocument()
  })

  it('shows permission-denied for 403 without empty state', async () => {
    vi.mocked(api.get).mockImplementation(async () => {
      throw new ApiError(403, 'Forbidden')
    })

    renderWithProviders(<PersonalApiKeysSection />)
    expect(await screen.findByText('Permission required')).toBeInTheDocument()
    expect(screen.queryByText('No API keys yet')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Create API key/i })).not.toBeInTheDocument()
  })

  it('shows recoverable error with retry', async () => {
    vi.mocked(api.get).mockImplementation(async () => {
      throw new ApiError(500, 'Server error')
    })

    renderWithProviders(<PersonalApiKeysSection />)
    expect(await screen.findByText('Server error')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Retry/i })).toBeInTheDocument()
  })

  it('lists keys and renders expired/revoked statuses', async () => {
    vi.mocked(api.get).mockImplementation(async (url: string) => {
      if (url.includes('/meta')) return meta
      return [
        makeToken({ id: 'a', name: 'Active key' }),
        makeToken({
          id: 'b',
          name: 'Expired key',
          expires_at: '2020-01-01T00:00:00Z',
        }),
        makeToken({
          id: 'c',
          name: 'Revoked key',
          revoked_at: '2026-02-01T00:00:00Z',
        }),
      ]
    })

    renderWithProviders(<PersonalApiKeysSection />)
    expect(await screen.findByText('Active key')).toBeInTheDocument()
    expect(screen.getByText('Expired')).toBeInTheDocument()
    expect(screen.getByText('Revoked')).toBeInTheDocument()
    expect(screen.getAllByText('Never used').length).toBeGreaterThan(0)
  })

  it('defaults create scopes to empty and keeps read/write independent', async () => {
    const user = userEvent.setup()
    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    renderWithProviders(<PersonalApiKeysSection />)
    await screen.findByText('No API keys yet')

    await user.click(screen.getAllByRole('button', { name: /Create API key/i })[0])
    expect(await screen.findByRole('heading', { name: 'Create API key' })).toBeInTheDocument()
    expect(screen.getByText(/Default: none selected/i)).toBeInTheDocument()

    const read = screen.getByRole('checkbox', { name: /Read tasks/i })
    const write = screen.getByRole('checkbox', { name: /Write tasks/i })
    expect(read).not.toBeChecked()
    expect(write).not.toBeChecked()

    await user.click(write)
    expect(write).toBeChecked()
    expect(read).not.toBeChecked()

    await user.click(read)
    expect(read).toBeChecked()
    expect(write).toBeChecked()

    expect(screen.getByText(/Workspace- and project-specific restrictions are not available/i)).toBeInTheDocument()
    expect(screen.queryByLabelText(/Restrict to workspace/i)).not.toBeInTheDocument()

    consoleSpy.mockRestore()
    consoleErrorSpy.mockRestore()
  })

  it('validates name and creates with empty scopes by default', async () => {
    const user = userEvent.setup()
    const created: ApiTokenCreated = {
      ...makeToken({ name: 'CI automation', scopes: [] }),
      token: RAW_SECRET,
    }
    vi.mocked(api.post).mockResolvedValue(created)

    renderWithProviders(<PersonalApiKeysSection />)
    await screen.findByText('No API keys yet')
    await user.click(screen.getAllByRole('button', { name: /Create API key/i })[0])

    await user.click(screen.getByRole('button', { name: 'Create key' }))
    expect(await screen.findByRole('alert')).toHaveTextContent(/Name is required/i)
    expect(api.post).not.toHaveBeenCalled()

    await user.type(screen.getByLabelText(/Key name/i), 'CI automation')
    await user.click(screen.getByRole('button', { name: 'Create key' }))

    await waitFor(() => {
      expect(api.post).toHaveBeenCalledWith('/users/me/api-tokens', {
        name: 'CI automation',
        scopes: [],
        expires_in_days: 90,
      })
    })

    expect(await screen.findByText(/only time the full key is displayed/i)).toBeInTheDocument()
    expect(screen.getByText(RAW_SECRET)).toBeInTheDocument()
    expect(localStorage.getItem('api-key')).toBeNull()
    expect(sessionStorage.length).toBe(0)
    expect(JSON.stringify(localStorage)).not.toContain(RAW_SECRET)
    expect(JSON.stringify(sessionStorage)).not.toContain(RAW_SECRET)
  })

  it('copy-once: secret gone after acknowledge; warns if closing early', async () => {
    const user = userEvent.setup()
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText },
    })

    const created: ApiTokenCreated = {
      ...makeToken({ name: 'Once' }),
      token: RAW_SECRET,
    }
    vi.mocked(api.post).mockImplementation(async (url: string) => {
      if (String(url).includes('ack-copied')) return { detail: 'Acknowledged' }
      return created
    })
    vi.mocked(api.get).mockImplementation(async (url: string) => {
      if (url.includes('/meta')) return meta
      return [makeToken({ name: 'Once' })]
    })

    renderWithProviders(<PersonalApiKeysSection />)
    await screen.findByText('Once')
    await user.click(screen.getByRole('button', { name: /Create API key/i }))
    await user.type(screen.getByLabelText(/Key name/i), 'Once')
    await user.click(screen.getByRole('button', { name: 'Create key' }))

    expect(await screen.findByText(RAW_SECRET)).toBeInTheDocument()
    expect(screen.getByText(/cannot show it again/i)).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Copy API key' }))
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(RAW_SECRET))
    // After a successful copy the raw secret is masked and Copy is locked.
    expect(screen.getByText(MASKED_SECRET)).toBeInTheDocument()
    expect(screen.queryByText(RAW_SECRET)).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'API key already copied' })).toBeDisabled()

    // Attempt close without ack
    await user.click(screen.getByRole('button', { name: 'Close' }))
    expect(screen.getByRole('alert')).toHaveTextContent(/Confirm you have saved/i)
    expect(screen.getByText(MASKED_SECRET)).toBeInTheDocument()

    await user.click(screen.getByRole('checkbox', { name: /I have saved this key/i }))
    await user.click(screen.getByRole('button', { name: 'Done' }))

    await waitFor(() => {
      expect(screen.queryByText(MASKED_SECRET)).not.toBeInTheDocument()
      expect(screen.queryByText(RAW_SECRET)).not.toBeInTheDocument()
    })
    expect(api.post).toHaveBeenCalledWith(expect.stringContaining('/usage/ack-copied'))
    expect(localStorage.length).toBe(0)
    expect(sessionStorage.length).toBe(0)
  })

  it('prevents double-submit on create', async () => {
    const user = userEvent.setup()
    let resolvePost: (v: ApiTokenCreated) => void = () => {}
    vi.mocked(api.post).mockImplementation(
      () =>
        new Promise((resolve) => {
          resolvePost = resolve
        }),
    )

    renderWithProviders(<PersonalApiKeysSection />)
    await screen.findByText('No API keys yet')
    await user.click(screen.getAllByRole('button', { name: /Create API key/i })[0])
    await user.type(screen.getByLabelText(/Key name/i), 'Slow key')

    const createBtn = screen.getByRole('button', { name: 'Create key' })
    await user.click(createBtn)
    expect(createBtn).toBeDisabled()
    await user.click(createBtn)
    expect(api.post).toHaveBeenCalledTimes(1)

    resolvePost({ ...makeToken({ name: 'Slow key' }), token: RAW_SECRET })
    expect(await screen.findByText(RAW_SECRET)).toBeInTheDocument()
  })

  it('revokes with confirmation', async () => {
    const user = userEvent.setup()
    vi.mocked(api.get).mockImplementation(async (url: string) => {
      if (url.includes('/meta')) return meta
      return [makeToken()]
    })
    vi.mocked(api.delete).mockResolvedValue({ detail: 'Token revoked' })

    renderWithProviders(<PersonalApiKeysSection />)
    expect(await screen.findByText('Reporting integration')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /Actions for Reporting integration/i }))
    await user.click(screen.getByRole('menuitem', { name: 'Revoke' }))

    expect(await screen.findByRole('heading', { name: 'Revoke API key' })).toBeInTheDocument()
    const revokeBtn = screen.getByRole('button', { name: 'Revoke key' })
    expect(revokeBtn).toBeDisabled()

    await user.click(screen.getByRole('checkbox', { name: /cannot be undone/i }))
    await user.click(revokeBtn)

    await waitFor(() => {
      expect(api.delete).toHaveBeenCalledWith('/users/me/api-tokens/tok-1')
    })
  })

  it('rotation shows copy-once secret and grace messaging', async () => {
    const user = userEvent.setup()
    vi.mocked(api.get).mockImplementation(async (url: string) => {
      if (url.includes('/meta')) return meta
      return [makeToken()]
    })
    vi.mocked(api.post).mockResolvedValue({
      ...makeToken({ id: 'tok-2', name: 'Reporting integration' }),
      token: 'fd_live_pk_new_rotatedsecret',
    })

    renderWithProviders(<PersonalApiKeysSection />)
    await screen.findByText('Reporting integration')

    await user.click(screen.getByRole('button', { name: /Actions for Reporting integration/i }))
    await user.click(screen.getByRole('menuitem', { name: 'Rotate' }))

    expect(await screen.findByText(/about 5 minutes/i)).toBeInTheDocument()
    const rotateBtn = screen.getByRole('button', { name: 'Rotate key' })
    expect(rotateBtn).toBeDisabled()

    await user.click(screen.getByRole('checkbox', { name: /grace period/i }))
    await user.click(rotateBtn)

    await waitFor(() => {
      expect(api.post).toHaveBeenCalledWith('/users/me/api-tokens/tok-1/rotate', {})
    })
    expect(await screen.findByText('fd_live_pk_new_rotatedsecret')).toBeInTheDocument()
    expect(screen.getByText(/Save your new API key/i)).toBeInTheDocument()
  })

  it('does not log secrets to console during create flow', async () => {
    const user = userEvent.setup()
    const log = vi.spyOn(console, 'log').mockImplementation(() => {})
    const info = vi.spyOn(console, 'info').mockImplementation(() => {})
    const debug = vi.spyOn(console, 'debug').mockImplementation(() => {})

    vi.mocked(api.post).mockResolvedValue({
      ...makeToken({ name: 'Quiet' }),
      token: RAW_SECRET,
    })

    renderWithProviders(<PersonalApiKeysSection />)
    await screen.findByText('No API keys yet')
    await user.click(screen.getAllByRole('button', { name: /Create API key/i })[0])
    await user.type(screen.getByLabelText(/Key name/i), 'Quiet')
    await user.click(screen.getByRole('button', { name: 'Create key' }))
    await screen.findByText(RAW_SECRET)

    const dumped = [...log.mock.calls, ...info.mock.calls, ...debug.mock.calls]
      .flat()
      .map(String)
      .join(' ')
    expect(dumped).not.toContain(RAW_SECRET)

    log.mockRestore()
    info.mockRestore()
    debug.mockRestore()
  })
})
