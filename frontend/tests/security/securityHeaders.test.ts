import { describe, expect, it } from 'vitest'

import {
  CONTENT_SECURITY_POLICY,
  PERMISSIONS_POLICY,
  REFERRER_POLICY,
  SECURITY_HEADERS,
} from '@/lib/securityHeaders'

describe('securityHeaders', () => {
  it('denies framing via CSP and X-Frame-Options', () => {
    expect(CONTENT_SECURITY_POLICY).toContain("frame-ancestors 'none'")
    expect(SECURITY_HEADERS['X-Frame-Options']).toBe('DENY')
  })

  it('restricts script sources to self and known third parties', () => {
    expect(CONTENT_SECURITY_POLICY).toContain("script-src 'self'")
    expect(CONTENT_SECURITY_POLICY).toContain('https://www.clarity.ms')
    expect(CONTENT_SECURITY_POLICY).toContain('https://accounts.google.com')
    expect(CONTENT_SECURITY_POLICY).not.toContain('fonts.googleapis.com')
  })

  it('blocks object embeds and sets referrer policy', () => {
    expect(CONTENT_SECURITY_POLICY).toContain("object-src 'none'")
    expect(REFERRER_POLICY).toBe('strict-origin-when-cross-origin')
    expect(SECURITY_HEADERS['Referrer-Policy']).toBe(REFERRER_POLICY)
  })

  it('restricts powerful browser features', () => {
    expect(PERMISSIONS_POLICY).toContain('camera=()')
    expect(PERMISSIONS_POLICY).toContain('microphone=()')
    expect(PERMISSIONS_POLICY).toContain('geolocation=()')
  })

  it('exports full production header set', () => {
    expect(SECURITY_HEADERS['Content-Security-Policy']).toBe(CONTENT_SECURITY_POLICY)
    expect(SECURITY_HEADERS['X-Content-Type-Options']).toBe('nosniff')
    expect(SECURITY_HEADERS['Strict-Transport-Security']).toContain('max-age=')
  })
})
