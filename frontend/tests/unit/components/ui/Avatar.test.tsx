import { render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { Avatar } from '@/components/ui/Avatar'

describe('Avatar', () => {
  beforeEach(() => {
    vi.resetModules()
  })

  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('resolves relative avatar URLs against VITE_API_URL', async () => {
    vi.stubEnv('VITE_API_URL', 'https://api.example.com')
    vi.stubEnv('PROD', true)
    const { Avatar: ResolvedAvatar } = await import('@/components/ui/Avatar')

    render(<ResolvedAvatar name="Jane Doe" src="/api/v1/users/u1/avatar?v=2" size={40} />)

    const img = screen.getByRole('img', { name: 'Jane Doe' }) as HTMLImageElement
    expect(img.src).toBe('https://api.example.com/api/v1/users/u1/avatar?v=2')
  })
})
