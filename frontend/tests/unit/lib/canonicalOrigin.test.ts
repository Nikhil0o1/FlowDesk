import { afterEach, describe, expect, it, vi } from 'vitest'

describe('canonicalOrigin', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('redirects flowdesk-ui.onrender.com to flowdesk.brightcone.ai preserving path', async () => {
    vi.stubEnv('PROD', true)
    const replace = vi.fn()
    Object.defineProperty(window, 'location', {
      value: {
        hostname: 'flowdesk-ui.onrender.com',
        href: 'https://flowdesk-ui.onrender.com/app/dashboard?x=1#token',
        replace,
      },
      writable: true,
      configurable: true,
    })
    vi.resetModules()
    const { redirectToCanonicalOriginIfNeeded } = await import('@/lib/canonicalOrigin')
    expect(redirectToCanonicalOriginIfNeeded()).toBe(true)
    expect(replace).toHaveBeenCalledWith('https://flowdesk.brightcone.ai/app/dashboard?x=1#token')
  })

  it('does not redirect the canonical host', async () => {
    vi.stubEnv('PROD', true)
    const replace = vi.fn()
    Object.defineProperty(window, 'location', {
      value: {
        hostname: 'flowdesk.brightcone.ai',
        href: 'https://flowdesk.brightcone.ai/app/dashboard',
        replace,
      },
      writable: true,
      configurable: true,
    })
    vi.resetModules()
    const { redirectToCanonicalOriginIfNeeded } = await import('@/lib/canonicalOrigin')
    expect(redirectToCanonicalOriginIfNeeded()).toBe(false)
    expect(replace).not.toHaveBeenCalled()
  })

  it('does not redirect in development', async () => {
    vi.stubEnv('PROD', false)
    const replace = vi.fn()
    Object.defineProperty(window, 'location', {
      value: {
        hostname: 'flowdesk-ui.onrender.com',
        href: 'https://flowdesk-ui.onrender.com/',
        replace,
      },
      writable: true,
      configurable: true,
    })
    vi.resetModules()
    const { redirectToCanonicalOriginIfNeeded } = await import('@/lib/canonicalOrigin')
    expect(redirectToCanonicalOriginIfNeeded()).toBe(false)
  })
})
