import { renderHook, act } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  greetingFirstName,
  timeGreeting,
  useTimeGreeting,
} from '@/lib/greeting'
import type { User } from '@/lib/types'

const user = {
  id: 'u1',
  email: 'alex@example.com',
  is_active: true,
  is_platform_superadmin: false,
  auth_provider: 'email',
  last_login_at: null,
  created_at: '2026-01-01',
  totp_enabled: false,
  profile: { full_name: 'Alex Rivera', avatar_url: null, avatar_color: null, status_text: null, title: null, timezone: 'UTC', phone: null, about: null },
} satisfies User

describe('timeGreeting', () => {
  it('returns morning before noon', () => {
    expect(timeGreeting(new Date('2026-07-07T08:00:00'))).toBe('Good morning')
  })

  it('returns afternoon before 5pm', () => {
    expect(timeGreeting(new Date('2026-07-07T14:00:00'))).toBe('Good afternoon')
  })

  it('returns evening at 5am boundary and afternoon at noon boundary', () => {
    expect(timeGreeting(new Date('2026-07-07T05:00:00'))).toBe('Good morning')
    expect(timeGreeting(new Date('2026-07-07T12:00:00'))).toBe('Good afternoon')
    expect(timeGreeting(new Date('2026-07-07T17:00:00'))).toBe('Good evening')
  })
})

describe('greetingFirstName', () => {
  it('uses profile first name', () => {
    expect(greetingFirstName(user)).toBe('Alex')
  })

  it('falls back to email local-part', () => {
    expect(greetingFirstName({ ...user, profile: null })).toBe('Alex')
  })

  it('returns empty when user is null', () => {
    expect(greetingFirstName(null)).toBe('')
  })

  it('capitalizes email local-part when display name is an email', () => {
    expect(
      greetingFirstName({
        ...user,
        profile: { ...user.profile!, full_name: 'dev@team.io' },
      }),
    ).toBe('Dev')
  })
})

describe('useTimeGreeting', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-07-07T09:00:00'))
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('updates greeting on interval and visibility change', () => {
    const { result } = renderHook(() => useTimeGreeting())
    expect(result.current).toBe('Good morning')

    act(() => {
      vi.setSystemTime(new Date('2026-07-07T18:00:00'))
      vi.advanceTimersByTime(60_000)
    })
    expect(result.current).toBe('Good evening')

    act(() => {
      vi.setSystemTime(new Date('2026-07-07T08:00:00'))
      document.dispatchEvent(new Event('visibilitychange'))
    })
    expect(result.current).toBe('Good morning')
  })
})
