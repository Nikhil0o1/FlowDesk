/**
 * CI smoke suite: page-level mounts only.
 *
 * Component smoke tests live in tests/smoke/components.smoke.test.tsx and are
 * run locally via `npm run test:smoke` — they duplicate unit coverage and
 * spawning 26 isolated Vitest processes was exceeding CI time limits.
 */
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

const smokeFiles = [
  'tests/smoke/pagesDeep.smoke.test.tsx',
  'tests/smoke/coverageBoost.smoke.test.tsx',
  'tests/smoke/pages.smoke.test.tsx',
  'tests/smoke/uncoveredPages.smoke.test.tsx',
]

for (const file of smokeFiles) {
  console.log(`\n--- smoke: ${file} ---\n`)
  const result = spawnSync(
    'npx',
    ['vitest', 'run', file, '--testTimeout=30000', '--no-file-parallelism'],
    {
      cwd: root,
      stdio: 'inherit',
      shell: true,
      timeout: 300_000,
      env: {
        ...process.env,
        NODE_OPTIONS: process.env.NODE_OPTIONS ?? '--max-old-space-size=4096',
      },
    },
  )
  if (result.error) {
    console.error(`Smoke failed to start ${file}:`, result.error.message)
    process.exit(1)
  }
  if (result.signal === 'SIGTERM') {
    console.error(`Smoke timed out after 5 minutes: ${file}`)
    process.exit(1)
  }
  if (result.status !== 0) {
    process.exit(result.status ?? 1)
  }
}
