import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const root = join(dirname(fileURLToPath(import.meta.url)), '../..')

function installedVersion(packageName: string): string {
  const pkgPath = join(root, 'node_modules', packageName, 'package.json')
  const pkg = JSON.parse(readFileSync(pkgPath, 'utf8')) as { version: string }
  return pkg.version
}

/** Compare dotted semver tuples (major.minor.patch). */
function gte(installed: string, minimum: string): boolean {
  const a = installed.split('.').map((n) => Number.parseInt(n, 10))
  const b = minimum.split('.').map((n) => Number.parseInt(n, 10))
  for (let i = 0; i < 3; i++) {
    const av = a[i] ?? 0
    const bv = b[i] ?? 0
    if (av > bv) return true
    if (av < bv) return false
  }
  return true
}

/**
 * VAPT issue #7 — pinned dependency CVEs (vite, react-router-dom).
 * @see https://github.com/yanthraa-information-systems/flowdesk_ui/issues/7
 */
describe('VAPT dependency minimums (issue #7)', () => {
  it('vite >= 6.4.3 (esbuild GHSA-67mh-4wv8-2f99 — dev-server request leak)', () => {
    const version = installedVersion('vite')
    expect(gte(version, '6.4.3'), `vite ${version} < 6.4.3`).toBe(true)
  })

  it('react-router-dom >= 6.30.2 (CVE-2025-68470 — open redirect via nav paths)', () => {
    const version = installedVersion('react-router-dom')
    expect(gte(version, '6.30.2'), `react-router-dom ${version} < 6.30.2`).toBe(true)
  })
})
