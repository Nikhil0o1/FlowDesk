import { describe, expect, it } from 'vitest'

import {
  apiKeyStatusLabel,
  deriveApiKeyStatus,
  maskApiKeyId,
  type ApiToken,
} from '@/lib/apiKeys'

function token(overrides: Partial<ApiToken> = {}): ApiToken {
  return {
    id: 'tok-1',
    name: 'CI automation',
    token_prefix: 'fd_live_',
    scopes: ['tasks:read'],
    expires_at: '2030-01-01T00:00:00Z',
    last_used_at: null,
    revoked_at: null,
    revoke_at: null,
    created_at: '2026-01-01T00:00:00Z',
    display_suffix: 'abcd',
    environment: 'live',
    public_key_id: 'pk_test123',
    rotated_from_id: null,
    ...overrides,
  }
}

describe('deriveApiKeyStatus', () => {
  it('returns active for a valid key', () => {
    expect(deriveApiKeyStatus(token(), new Date('2026-06-01T00:00:00Z'))).toBe('active')
  })

  it('returns expiring_soon within 14 days', () => {
    expect(
      deriveApiKeyStatus(token({ expires_at: '2026-06-10T00:00:00Z' }), new Date('2026-06-01T00:00:00Z')),
    ).toBe('expiring_soon')
  })

  it('returns expired when expires_at is past', () => {
    expect(
      deriveApiKeyStatus(token({ expires_at: '2026-05-01T00:00:00Z' }), new Date('2026-06-01T00:00:00Z')),
    ).toBe('expired')
  })

  it('returns revocation_scheduled when revoke_at is in the future', () => {
    expect(
      deriveApiKeyStatus(token({ revoke_at: '2026-06-01T00:05:00Z' }), new Date('2026-06-01T00:00:00Z')),
    ).toBe('revocation_scheduled')
  })

  it('returns revoked when revoked_at is set', () => {
    expect(
      deriveApiKeyStatus(token({ revoked_at: '2026-05-01T00:00:00Z' }), new Date('2026-06-01T00:00:00Z')),
    ).toBe('revoked')
  })

  it('labels statuses for UI', () => {
    expect(apiKeyStatusLabel('revocation_scheduled')).toBe('Revocation scheduled')
    expect(apiKeyStatusLabel('expiring_soon')).toBe('Expiring soon')
  })
})

describe('maskApiKeyId', () => {
  it('masks with public_key_id and display suffix', () => {
    expect(maskApiKeyId(token())).toBe('fd_live_pk_test123…abcd')
  })

  it('falls back to token_prefix', () => {
    expect(maskApiKeyId(token({ public_key_id: null, display_suffix: null }))).toBe('fd_live_…')
  })
})
