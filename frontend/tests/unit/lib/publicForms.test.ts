import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/env', () => ({ API_BASE: '/api/v1' }))

import {
  copyPublicFormLink,
  fetchPublicForm,
  publicFormEmbedCode,
  publicFormUrl,
  submitPublicForm,
} from '@/lib/publicForms'

describe('publicFormUrl', () => {
  it('builds an SPA fill URL from the public token', () => {
    expect(publicFormUrl('abc123')).toBe(`${window.location.origin}/f/abc123`)
  })
})

describe('publicFormEmbedCode', () => {
  it('returns a fixed-height iframe by default', () => {
    const code = publicFormEmbedCode('tok')
    expect(code).toContain(`src="${publicFormUrl('tok')}"`)
    expect(code).toContain('height:600px')
  })

  it('uses min-height when autosize is enabled', () => {
    const code = publicFormEmbedCode('tok', { autosize: true })
    expect(code).toContain('min-height:480px')
    expect(code).not.toContain('height:600px')
  })

  it('respects custom height', () => {
    const code = publicFormEmbedCode('tok', { height: 800 })
    expect(code).toContain('height:800px')
  })
})

describe('fetchPublicForm', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn())
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('loads a public form definition', async () => {
    const form = { id: 'f1', name: 'Survey', fields: [] }
    vi.mocked(fetch).mockResolvedValue(
      new Response(JSON.stringify(form), { status: 200 }),
    )
    await expect(fetchPublicForm('tok')).resolves.toEqual(form)
    expect(fetch).toHaveBeenCalledWith(
      '/api/v1/public/forms/tok',
      expect.objectContaining({ method: 'GET', credentials: 'omit' }),
    )
  })

  it('throws server detail on error responses', async () => {
    vi.mocked(fetch).mockResolvedValue(
      new Response(JSON.stringify({ detail: 'Form expired' }), { status: 404 }),
    )
    await expect(fetchPublicForm('tok')).rejects.toThrow('Form expired')
  })

  it('throws a helpful message for HTML error bodies', async () => {
    vi.mocked(fetch).mockResolvedValue(new Response('<html>502</html>', { status: 502 }))
    await expect(fetchPublicForm('tok')).rejects.toThrow(/Could not reach the form API/)
  })
})

describe('submitPublicForm', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn())
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('posts form values without auth', async () => {
    vi.mocked(fetch).mockResolvedValue(new Response('{}', { status: 200 }))
    await submitPublicForm('tok', { values: { q1: 'yes' } })
    expect(fetch).toHaveBeenCalledWith(
      '/api/v1/public/forms/tok',
      expect.objectContaining({
        method: 'POST',
        credentials: 'omit',
        body: JSON.stringify({ values: { q1: 'yes' } }),
      }),
    )
  })
})

describe('copyPublicFormLink', () => {
  it('copies the public URL to the clipboard', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    vi.stubGlobal('navigator', { clipboard: { writeText } })
    const url = await copyPublicFormLink('tok')
    expect(url).toBe(publicFormUrl('tok'))
    expect(writeText).toHaveBeenCalledWith(url)
    vi.unstubAllGlobals()
  })
})
