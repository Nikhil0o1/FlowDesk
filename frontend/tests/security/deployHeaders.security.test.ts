import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

import { SECURITY_HEADERS } from '@/lib/securityHeaders'

import {
  headersFromCloudflareJson,
  headersFromVercelJson,
  parseRenderYamlHeaders,
  readRenderYaml,
} from './deployHeaders.util'

const root = join(dirname(fileURLToPath(import.meta.url)), '../..')

/** Headers required after issue #8 reopen (2026-06-23); shared with VAPT #1. */
const REQUIRED_PRODUCTION_HEADERS = [
  'Content-Security-Policy',
  'Cross-Origin-Opener-Policy',
  'X-Frame-Options',
  'Permissions-Policy',
  'Strict-Transport-Security',
] as const

/**
 * VAPT issues #1, #4, #8 — response headers must be delivered on Render / Cloudflare, not only vercel.json.
 */
describe('VAPT deploy response headers (#1 / #4 / #8)', () => {
  it('vercel.json matches securityHeaders.ts', () => {
    expect(headersFromVercelJson()).toEqual(SECURITY_HEADERS)
  })

  it('render.yaml headers match vercel.json (Render static site)', () => {
    const vercel = headersFromVercelJson()
    const render = parseRenderYamlHeaders(readRenderYaml())
    expect(render).toEqual(vercel)
  })

  it('cloudflare-response-headers.json matches vercel.json', () => {
    const vercel = headersFromVercelJson()
    const cloudflare = headersFromCloudflareJson()
    expect(cloudflare).toEqual(vercel)
  })

  it('includes COOP, Permissions-Policy, HSTS, CSP, and X-Frame-Options', () => {
    const headers = headersFromVercelJson()
    for (const key of REQUIRED_PRODUCTION_HEADERS) {
      expect(headers[key], `missing ${key}`).toBeTruthy()
    }
    expect(headers['Cross-Origin-Opener-Policy']).toBe('same-origin-allow-popups')
    expect(headers['Permissions-Policy']).toContain('camera=()')
    expect(headers['Strict-Transport-Security']).toContain('max-age=')
  })

  it('CSP blocks clickjacking and allow-lists Clarity (issues #1 and #4)', () => {
    const csp = headersFromVercelJson()['Content-Security-Policy']
    expect(csp).toContain("frame-ancestors 'none'")
    expect(csp).toContain("script-src 'self'")
    expect(csp).toContain('https://www.clarity.ms')
    expect(csp).toContain('https://scripts.clarity.ms')
    expect(csp).not.toContain('fonts.googleapis.com')
  })

  it('documents Render and Cloudflare delivery paths in deploy artifacts', () => {
    expect(readRenderYaml()).toMatch(/Render Blueprint/)
    expect(readRenderYaml()).toMatch(/sync-deploy-headers/)
    const cloudflareDoc = JSON.parse(
      readFileSync(join(root, 'deploy/cloudflare-response-headers.json'), 'utf8'),
    ) as { _comment?: string }
    expect(cloudflareDoc._comment).toMatch(/Cloudflare/)
  })
})
