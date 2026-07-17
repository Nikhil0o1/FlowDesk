#!/usr/bin/env node
/**
 * Verify production (or staging) serves VAPT security headers.
 * Usage: node scripts/verify-production-headers.mjs [url]
 * Default URL: FLOWDESK_UI_URL env or https://flowdesk.brightcone.ai/
 */
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const defaultUrl = process.env.FLOWDESK_UI_URL ?? 'https://flowdesk.brightcone.ai/'
const target = process.argv[2] ?? defaultUrl

const expected = JSON.parse(
  readFileSync(join(root, 'deploy/cloudflare-response-headers.json'), 'utf8'),
).headers

const REQUIRED = [
  'content-security-policy',
  'x-frame-options',
  'cross-origin-opener-policy',
  'permissions-policy',
  'strict-transport-security',
]

function normalizeHeaders(response) {
  const out = {}
  response.headers.forEach((value, key) => {
    out[key.toLowerCase()] = value
  })
  return out
}

const res = await fetch(target, { method: 'HEAD', redirect: 'follow' })
const live = normalizeHeaders(res)

const missing = REQUIRED.filter((key) => !live[key])
const mismatched = []

for (const [name, value] of Object.entries(expected)) {
  const key = name.toLowerCase()
  if (live[key] && live[key] !== value) {
    mismatched.push({ name, expected: value, actual: live[key] })
  }
}

if (missing.length > 0) {
  console.error(`FAIL: ${target} is missing headers: ${missing.join(', ')}`)
  console.error('Apply render.yaml (Render Blueprint sync) or deploy/cloudflare-response-headers.json (Cloudflare).')
  process.exit(1)
}

if (mismatched.length > 0) {
  console.error(`FAIL: ${target} header value drift:`)
  for (const row of mismatched) {
    console.error(`  ${row.name}: expected "${row.expected}" got "${row.actual}"`)
  }
  process.exit(1)
}

console.log(`OK: ${target} serves all VAPT security headers (#1 / #4 / #8).`)
for (const key of REQUIRED) {
  console.log(`  ${key}: present`)
}
