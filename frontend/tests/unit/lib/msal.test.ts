import { describe, expect, it } from 'vitest'

import { MSAL_CACHE_LOCATION } from '@/lib/msal'

describe('msal cache configuration', () => {
  it('uses sessionStorage so loginRedirect can persist PKCE across the round-trip', () => {
    expect(MSAL_CACHE_LOCATION).toBe('sessionStorage')
  })
})
