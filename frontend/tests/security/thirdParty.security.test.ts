import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const root = join(dirname(fileURLToPath(import.meta.url)), '../..')

function readRootFile(relativePath: string): string {
  return readFileSync(join(root, relativePath), 'utf8')
}

/**
 * VAPT issue #4 — no third-party script/font tags in static HTML; fonts self-hosted.
 * @see https://github.com/yanthraa-information-systems/flowdesk_ui/issues/4
 */
describe('VAPT third-party surface (issue #4)', () => {
  it('index.html does not load Clarity or Google Fonts from a CDN', () => {
    const html = readRootFile('index.html')
    expect(html).not.toMatch(/clarity\.ms/i)
    expect(html).not.toMatch(/fonts\.googleapis\.com/i)
    expect(html).not.toMatch(/fonts\.gstatic\.com/i)
  })

  it('index.html has no inline third-party boot scripts', () => {
    const html = readRootFile('index.html')
    expect(html).not.toMatch(/<script(?![^>]*type="module")[^>]*>/i)
    expect(html).toMatch(/<script type="module" src="\/src\/main\.tsx"><\/script>/)
  })

  it('fonts are self-hosted via @fontsource/inter in the app bundle', () => {
    const css = readRootFile('src/index.css')
    expect(css).toMatch(/@fontsource\/inter/)
    expect(css).not.toMatch(/fonts\.googleapis\.com/)
  })

  it('Clarity is loaded from a controlled module with consent and masking', () => {
    const clarity = readRootFile('src/lib/clarity.ts')
    expect(clarity).toMatch(/clarity\('consent'\)/)
    expect(clarity).toMatch(/data-clarity-mask/)
    expect(clarity).toMatch(/script\.async\s*=\s*true/)
    expect(clarity).toMatch(/script\.src\s*=\s*clarityScriptUrl\(\)/)
    const main = readRootFile('src/main.tsx')
    expect(main).toMatch(/initClarity\(\)/)
    expect(main).not.toMatch(/clarity\.ms/)
  })
})
