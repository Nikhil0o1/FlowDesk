import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '../..')

/** Parse Render Blueprint `headers:` list items (path /* + name + value). */
export function parseRenderYamlHeaders(yaml: string): Record<string, string> {
  const result: Record<string, string> = {}
  const normalized = yaml.replace(/\r\n/g, '\n')
  const headerBlock = normalized.match(/^ {4}headers:\n([\s\S]*)$/m)?.[1]
  if (!headerBlock) return result

  const entryRe = /name:\s+([^\n]+)\n\s+value:\s+([^\n]+)/g
  let match: RegExpExecArray | null
  while ((match = entryRe.exec(headerBlock)) !== null) {
    let val = match[2].trim()
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1).replace(/\\"/g, '"').replace(/\\\\/g, '\\')
    }
    result[match[1].trim()] = val
  }

  return result
}

export function headersFromVercelJson(): Record<string, string> {
  const vercel = JSON.parse(readFileSync(join(root, 'vercel.json'), 'utf8'))
  const rules = vercel.headers?.[0]?.headers
  if (!Array.isArray(rules)) throw new Error('vercel.json: missing headers[0].headers')
  return Object.fromEntries(rules.map(({ key, value }: { key: string; value: string }) => [key, value]))
}

export function headersFromCloudflareJson(): Record<string, string> {
  const doc = JSON.parse(readFileSync(join(root, 'deploy/cloudflare-response-headers.json'), 'utf8'))
  if (!doc.headers || typeof doc.headers !== 'object') {
    throw new Error('deploy/cloudflare-response-headers.json: missing headers object')
  }
  return doc.headers as Record<string, string>
}

export function readRenderYaml(): string {
  return readFileSync(join(root, 'render.yaml'), 'utf8')
}
