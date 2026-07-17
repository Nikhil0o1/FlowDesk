/**
 * Copy Vitest gate totals from coverage/coverage-summary.json
 * into tests/coverage-summary.json (committed snapshot for the test report).
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const source = join(root, 'coverage', 'coverage-summary.json')
const target = join(root, 'tests', 'coverage-summary.json')

const summary = JSON.parse(readFileSync(source, 'utf8'))
writeFileSync(
  target,
  JSON.stringify({ total: summary.total, generatedAt: new Date().toISOString() }, null, 2) + '\n',
  'utf8',
)

console.log('Synced coverage summary -> tests/coverage-summary.json')
