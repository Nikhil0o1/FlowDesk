import { describe, expect, it } from 'vitest'

import { INVITE_EMAIL_ERROR, isValidInviteEmail } from '@/lib/emailValidation'

describe('isValidInviteEmail', () => {
  it('accepts common valid addresses', () => {
    expect(isValidInviteEmail('teammate@company.com')).toBe(true)
    expect(isValidInviteEmail('newadmin@test.dev')).toBe(true)
    expect(isValidInviteEmail(' first.last+tag@sub.domain.co ')).toBe(true)
  })

  it('accepts canonical provider addresses', () => {
    expect(isValidInviteEmail('user@gmail.com')).toBe(true)
    expect(isValidInviteEmail('user@googlemail.com')).toBe(true)
    expect(isValidInviteEmail('user@outlook.com')).toBe(true)
    expect(isValidInviteEmail('user@msn.com')).toBe(true)
  })

  it('accepts microsoft regional domains', () => {
    expect(isValidInviteEmail('user@outlook.in')).toBe(true)
    expect(isValidInviteEmail('user@outlook.co.in')).toBe(true)
    expect(isValidInviteEmail('user@hotmail.co.uk')).toBe(true)
    expect(isValidInviteEmail('user@live.in')).toBe(true)
  })

  it('rejects fake provider typosquats', () => {
    expect(isValidInviteEmail('ganesh@gmailkkdsfm.com')).toBe(false)
    expect(isValidInviteEmail('user@outlookfake.com')).toBe(false)
    expect(isValidInviteEmail('user@outlookjhvkjv.in')).toBe(false)
  })

  it('rejects regional gmail domains', () => {
    expect(isValidInviteEmail('user@gmail.in')).toBe(false)
    expect(isValidInviteEmail('user@gmail.co.uk')).toBe(false)
  })

  it('still accepts other domains with non-.com TLDs', () => {
    expect(isValidInviteEmail('user@company.co.in')).toBe(true)
  })

  it('rejects malformed addresses', () => {
    expect(isValidInviteEmail('')).toBe(false)
    expect(isValidInviteEmail('notanemail')).toBe(false)
    expect(isValidInviteEmail('bad@')).toBe(false)
    expect(isValidInviteEmail('@domain.com')).toBe(false)
    expect(isValidInviteEmail('user@domain')).toBe(false)
    expect(isValidInviteEmail('user..name@domain.com')).toBe(false)
  })

  it('exports a user-facing error message', () => {
    expect(INVITE_EMAIL_ERROR).toMatch(/valid email/i)
  })
})
