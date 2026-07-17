/**
 * @vitest-environment jsdom
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { consumeAuthTokenFromUrl, parseFragmentToken, parseQueryToken } from '@/lib/fragmentToken'

let locationState = { pathname: '/activate-invite', search: '', hash: '' }

function syncLocation() {
  const { pathname, search, hash } = locationState
  Object.defineProperty(window, 'location', {
    configurable: true,
    writable: true,
    value: {
      pathname,
      search,
      hash,
      href: `http://localhost${pathname}${search}${hash}`,
      assign: vi.fn(),
      replace: vi.fn(),
      reload: vi.fn(),
    },
  })
}

function setLocation(path: string, search = '', hash = '') {
  locationState = { pathname: path, search, hash }
  syncLocation()
}

describe('parseFragmentToken', () => {
  beforeEach(() => {
    setLocation('/activate-invite')
    vi.spyOn(window.history, 'replaceState').mockImplementation((_state, _title, url) => {
      const parsed = new URL(String(url), 'http://localhost')
      locationState = { pathname: parsed.pathname, search: parsed.search, hash: parsed.hash }
      syncLocation()
    })
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('reads token from the URL hash', () => {
    setLocation('/activate-invite', '', '#token=abc123')
    expect(parseFragmentToken()).toBe('abc123')
  })
})

describe('parseQueryToken', () => {
  beforeEach(() => {
    setLocation('/activate-invite')
    vi.spyOn(window.history, 'replaceState').mockImplementation((_state, _title, url) => {
      const parsed = new URL(String(url), 'http://localhost')
      locationState = { pathname: parsed.pathname, search: parsed.search, hash: parsed.hash }
      syncLocation()
    })
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('reads legacy query tokens', () => {
    setLocation('/activate-invite', '?token=legacy')
    expect(parseQueryToken()).toBe('legacy')
  })
})

describe('consumeAuthTokenFromUrl', () => {
  beforeEach(() => {
    setLocation('/activate-invite')
    vi.spyOn(window.history, 'replaceState').mockImplementation((_state, _title, url) => {
      const parsed = new URL(String(url), 'http://localhost')
      locationState = { pathname: parsed.pathname, search: parsed.search, hash: parsed.hash }
      syncLocation()
    })
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('prefers fragment over query and strips the URL', () => {
    setLocation('/activate-invite', '?token=legacy', '#token=fragment')
    expect(consumeAuthTokenFromUrl('activate-invite')).toBe('fragment')
    expect(window.location.pathname).toBe('/activate-invite')
    expect(window.location.search).toBe('')
    expect(window.location.hash).toBe('')
  })

  it('accepts path tokens and normalizes the URL', () => {
    setLocation('/activate-invite/encoded%2Ftoken')
    expect(consumeAuthTokenFromUrl('activate-invite', 'encoded%2Ftoken')).toBe('encoded/token')
    expect(window.location.pathname).toBe('/activate-invite')
  })
})
