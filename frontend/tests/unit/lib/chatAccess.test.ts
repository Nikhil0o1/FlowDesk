import { describe, expect, it } from 'vitest'

import { CHAT_CREATE_PATH, canCreateChannel } from '@/lib/chatAccess'

describe('canCreateChannel', () => {
  it('allows workspace admins', () => {
    expect(canCreateChannel(null, { my_role: 'admin' } as never)).toBe(true)
  })

  it('allows workspace owners', () => {
    expect(canCreateChannel(null, { my_role: 'owner' } as never)).toBe(true)
  })

  it('allows org owners', () => {
    expect(canCreateChannel({ my_role: 'owner' } as never, { my_role: 'member' } as never)).toBe(
      true,
    )
  })

  it('denies regular members', () => {
    expect(canCreateChannel({ my_role: 'member' } as never, { my_role: 'member' } as never)).toBe(
      false,
    )
  })

  it('handles null org and workspace', () => {
    expect(canCreateChannel(null, null)).toBe(false)
  })
})

describe('CHAT_CREATE_PATH', () => {
  it('opens the new-channel modal via query flag', () => {
    expect(CHAT_CREATE_PATH).toBe('/app/chat?new=1')
  })
})
