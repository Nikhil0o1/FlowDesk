/**
 * @vitest-environment jsdom
 */
import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  CLARITY_INPUT_MASKING_ENABLED,
  CLARITY_PROJECT_ID,
  clarityScriptUrl,
  initClarity,
} from '@/lib/clarity'

describe('clarity configuration', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
    document.documentElement.removeAttribute('data-clarity-mask')
    document.querySelectorAll('script[src*="clarity.ms"]').forEach((node) => node.remove())
    delete window.clarity
  })

  it('loads from the official Clarity host only', () => {
    expect(clarityScriptUrl('test-project')).toBe('https://www.clarity.ms/tag/test-project')
  })

  it('has a configured project id', () => {
    expect(CLARITY_PROJECT_ID.length).toBeGreaterThan(0)
  })

  it('documents that input masking is enabled', () => {
    expect(CLARITY_INPUT_MASKING_ENABLED).toBe(true)
  })

  it('initClarity injects the script and enables masking', () => {
    document.head.appendChild(document.createElement('script'))
    vi.stubEnv('PROD', true)
    initClarity()
    expect(document.documentElement.getAttribute('data-clarity-mask')).toBe('true')
    const injected = document.querySelector('script[src*="clarity.ms"]') as HTMLScriptElement | null
    expect(injected).toBeTruthy()
    expect(injected?.crossOrigin).toBe('anonymous')
    expect(window.clarity).toBeTypeOf('function')
  })
})
