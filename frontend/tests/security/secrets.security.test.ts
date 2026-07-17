import { readFileSync, readdirSync, statSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const root = join(dirname(fileURLToPath(import.meta.url)), '../..')

const SKIP_DIRS = new Set([
  'node_modules',
  'dist',
  'coverage',
  'security-reports',
  '.git',
])

const SECRET_PATTERNS: RegExp[] = [
  /api[_-]?key\s*=\s*['"][^'"]{8,}['"]/i,
  /secret[_-]?key\s*=\s*['"][^'"]{8,}['"]/i,
  /password\s*=\s*['"][^'"]{6,}['"]/i,
  /BEGIN (RSA |OPENSSH )?PRIVATE KEY/,
  /ghp_[a-zA-Z0-9]{20,}/,
  /github_pat_[a-zA-Z0-9_]{20,}/,
  /sk-[a-zA-Z0-9]{20,}/,
]

function collectFiles(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name)
    if (SKIP_DIRS.has(name)) continue
    const st = statSync(path)
    if (st.isDirectory()) {
      collectFiles(path, out)
      continue
    }
    if (!/\.(ts|tsx|js|jsx|json|html|css|md|yml|yaml|sh|env\.example)$/.test(name)) continue
    if (name.endsWith('.test.ts') || name.endsWith('.test.tsx')) continue
    out.push(path)
  }
  return out
}

/** Gitleaks/TruffleHog complement: no obvious secrets in tracked source trees. */   
describe('committed source secret patterns', () => {
  const scanRoots = ['src', 'tests/helpers', 'scripts', '.github'].map((p) => join(root, p))

  it(
    'has no hardcoded API keys, passwords, or private keys in source trees',
    () => {
      const offenders: string[] = []
      for (const scanRoot of scanRoots) {
        for (const file of collectFiles(scanRoot)) {
          const rel = file.slice(root.length + 1).replace(/\\/g, '/')
          if (rel.includes('.env')) continue
          const text = readFileSync(file, 'utf8')
          for (const pattern of SECRET_PATTERNS) {
            if (pattern.test(text)) {
              offenders.push(`${rel} matched ${pattern}`)
            }
          }
        }
      }
      expect(offenders, offenders.join('\n')).toEqual([])
    },
    15_000,
  )

  it('keeps .env out of git via .gitignore', () => {
    const gitignore = readFileSync(join(root, '.gitignore'), 'utf8')
    expect(gitignore).toMatch(/^\.env$/m)
  })
})