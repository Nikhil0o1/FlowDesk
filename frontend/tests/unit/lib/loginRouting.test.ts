import { describe, expect, it } from 'vitest'

import { loginLandingPath } from '@/lib/loginRouting'
import type { LoginContext } from '@/lib/types'

function ctx(partial: Partial<LoginContext>): LoginContext {
  return {
    kind: 'member',
    role: 'member',
    organization_id: 'org-1',
    workspace_id: 'ws-1',
    project_id: null,
    redirect_to: '/app/dashboard',
    ...partial,
  }
}

describe('loginLandingPath', () => {
  it('returns server redirect when it is a safe relative path', () => {
    expect(loginLandingPath(ctx({ redirect_to: '/app/workspaces/ws-1' }))).toBe(
      '/app/workspaces/ws-1',
    )
  })

  it('falls back when redirect_to is an open redirect', () => {
    expect(loginLandingPath(ctx({ redirect_to: '//evil.com' }))).toBe('/app/dashboard')
    expect(loginLandingPath(ctx({ redirect_to: 'https://evil.com' }))).toBe('/app/dashboard')
  })
})
