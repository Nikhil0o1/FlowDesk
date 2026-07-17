import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

describe('env', () => {
  beforeEach(() => {
    vi.resetModules()
  })

  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('uses same-origin /api/v1 when VITE_API_URL is empty in dev', async () => {
    vi.stubEnv('VITE_API_URL', '')
    vi.stubEnv('PROD', false)
    const { API_BASE, API_ORIGIN } = await import('@/lib/env')
    expect(API_ORIGIN).toBe('')
    expect(API_BASE).toBe('/api/v1')
  })

  it('strips trailing slashes from VITE_API_URL', async () => {
    vi.stubEnv('VITE_API_URL', 'https://api.example.com///')
    vi.stubEnv('PROD', false)
    const { API_BASE, API_ORIGIN } = await import('@/lib/env')
    expect(API_ORIGIN).toBe('https://api.example.com')
    expect(API_BASE).toBe('https://api.example.com/api/v1')
  })

  it('derives API origin from flowdesk.brightcone.ai in prod', async () => {
    vi.stubEnv('VITE_API_URL', '')
    vi.stubEnv('PROD', true)
    Object.defineProperty(window, 'location', {
      value: { hostname: 'flowdesk.brightcone.ai', protocol: 'https:' },
      writable: true,
      configurable: true,
    })
    const { API_ORIGIN } = await import('@/lib/env')
    expect(API_ORIGIN).toBe('https://flowdesk-api-mvwt.onrender.com')
  })

  it('derives API origin from -ui. to -api. hostname pattern', async () => {
    vi.stubEnv('VITE_API_URL', '')
    vi.stubEnv('PROD', true)
    Object.defineProperty(window, 'location', {
      value: { hostname: 'my-app-ui.onrender.com', protocol: 'https:' },
      writable: true,
      configurable: true,
    })
    const { API_ORIGIN } = await import('@/lib/env')
    expect(API_ORIGIN).toBe('https://my-app-api.onrender.com')
  })

  it('assertProductionApiConfig throws when prod without API origin', async () => {
    vi.stubEnv('VITE_API_URL', '')
    vi.stubEnv('PROD', true)
    Object.defineProperty(window, 'location', {
      value: { hostname: 'localhost', protocol: 'http:' },
      writable: true,
      configurable: true,
    })
    const { assertProductionApiConfig } = await import('@/lib/env')
    expect(() => assertProductionApiConfig()).toThrow(/VITE_API_URL/)
  })

  it('assertProductionApiConfig is a no-op when API origin is configured', async () => {
    vi.stubEnv('VITE_API_URL', 'https://api.example.com')
    vi.stubEnv('PROD', true)
    const { assertProductionApiConfig } = await import('@/lib/env')
    expect(() => assertProductionApiConfig()).not.toThrow()
  })

  it('assertProductionApiConfig allows the flowdesk.brightcone.ai hostname', async () => {
    vi.stubEnv('VITE_API_URL', '')
    vi.stubEnv('PROD', true)
    Object.defineProperty(window, 'location', {
      value: { hostname: 'flowdesk.brightcone.ai', protocol: 'https:' },
      writable: true,
      configurable: true,
    })
    const { assertProductionApiConfig } = await import('@/lib/env')
    expect(() => assertProductionApiConfig()).not.toThrow()
  })

  it('resolveAvatarUrl prefixes API origin for relative avatar paths', async () => {
    vi.stubEnv('VITE_API_URL', 'https://api.example.com')
    vi.stubEnv('PROD', true)
    const { resolveAvatarUrl } = await import('@/lib/env')
    expect(resolveAvatarUrl('/api/v1/users/u1/avatar?v=1')).toBe(
      'https://api.example.com/api/v1/users/u1/avatar?v=1',
    )
    expect(resolveAvatarUrl('https://lh3.googleusercontent.com/a/abc')).toBe(
      'https://lh3.googleusercontent.com/a/abc',
    )
  })

  it('resolveAvatarUrl keeps relative paths in same-origin dev', async () => {
    vi.stubEnv('VITE_API_URL', '')
    vi.stubEnv('PROD', false)
    const { resolveAvatarUrl } = await import('@/lib/env')
    expect(resolveAvatarUrl('/api/v1/users/u1/avatar?v=1')).toBe('/api/v1/users/u1/avatar?v=1')
    expect(resolveAvatarUrl(null)).toBeUndefined()
  })
})
