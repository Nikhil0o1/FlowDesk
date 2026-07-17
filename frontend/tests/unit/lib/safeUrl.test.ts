import { describe, expect, it } from 'vitest'

import { safeAppPath, safeExternalUrl, safeGithubOAuthUrl, safeGithubUrl, safeHttpUrl, openExternalUrl } from '@/lib/safeUrl'

describe('safeHttpUrl', () => {
  it('allows http, https, and mailto', () => {
    expect(safeHttpUrl('https://example.com/x')).toBe('https://example.com/x')
    expect(safeHttpUrl('mailto:team@example.com')).toBe('mailto:team@example.com')
  })

  it('blocks javascript and data URLs', () => {
    expect(safeHttpUrl('javascript:alert(1)')).toBeNull()
    expect(safeHttpUrl('data:text/html,<script>alert(1)</script>')).toBeNull()
  })
})

describe('openExternalUrl', () => {
  it('rejects unsafe URLs', () => {
    expect(openExternalUrl('javascript:alert(1)')).toBe(false)
    expect(openExternalUrl('data:text/html,x')).toBe(false)
  })
})

describe('safeExternalUrl', () => {
  it('blocks javascript and data URLs', () => {
    expect(safeExternalUrl('javascript:alert(1)')).toBeNull()
    expect(safeExternalUrl('data:text/html,<script>alert(1)</script>')).toBeNull()
  })

  it('blocks protocol-relative URLs', () => {
    expect(safeExternalUrl('//evil.com')).toBeNull()
  })

  it('allows https URLs', () => {
    expect(safeExternalUrl('https://github.com/org/repo')).toBe('https://github.com/org/repo')
  })
})

describe('safeGithubUrl', () => {
  it('restricts hosts when provided', () => {
    expect(safeGithubUrl('https://evil.com/x')).toBeNull()
    expect(safeGithubUrl('https://github.com/org/repo/issues/1')).toBe(
      'https://github.com/org/repo/issues/1',
    )
  })
})

describe('safeGithubOAuthUrl', () => {
  it('allows GitHub OAuth authorize URLs only', () => {
    expect(
      safeGithubOAuthUrl('https://github.com/login/oauth/authorize?client_id=abc'),
    ).toBe('https://github.com/login/oauth/authorize?client_id=abc')
    expect(safeGithubOAuthUrl('https://github.com/org/repo')).toBeNull()
    expect(safeGithubOAuthUrl('https://evil.com/login/oauth/authorize')).toBeNull()
  })
})

describe('safeAppPath', () => {
  it('allows internal paths', () => {
    expect(safeAppPath('/app/tasks/1')).toBe('/app/tasks/1')
  })

  it('blocks external paths', () => {
    expect(safeAppPath('//evil.com')).toBeNull()
    expect(safeAppPath('https://evil.com')).toBeNull()
  })
})
