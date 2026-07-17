import { describe, expect, it } from 'vitest'

import {
  maskClientId,
  suggestRedirectFromCallbackBase,
  suggestWebhookFromAppBase,
} from '@/lib/oauthApps'

describe('oauthApps helpers', () => {
  it('masks client ids', () => {
    expect(maskClientId('fd_app_ABCDEFGHIJKLMNOPQRSTUV')).toContain('…')
    expect(maskClientId('short')).toBe('short')
  })

  it('suggests redirect and webhook URLs from an app base', () => {
    const base = 'https://apps.example.com/'
    expect(suggestRedirectFromCallbackBase(base)).toBe(
      'https://apps.example.com/api/v1/tools/config/oauth/callback',
    )
    expect(suggestWebhookFromAppBase(base)).toBe(
      'https://apps.example.com/api/v1/webhooks/flowdesk',
    )
  })
})
