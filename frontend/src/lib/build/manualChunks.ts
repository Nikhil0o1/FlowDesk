const CHUNK_MATCHERS: Array<[chunk: string, packages: string[]]> = [
  ['vendor-react', ['react', 'react-dom', 'react-router', 'react-router-dom']],
  ['vendor-query', ['@tanstack']],
  ['vendor-icons', ['lucide-react']],
  ['vendor-state', ['zustand']],
  ['feature-auth-msal', ['@azure/msal-browser']],
]

function packageNameFromId(id: string): string | undefined {
  const normalized = id.split('\\').join('/')
  const marker = '/node_modules/'
  const markerIndex = normalized.lastIndexOf(marker)
  if (markerIndex === -1) return undefined

  const parts = normalized.slice(markerIndex + marker.length).split('/')
  if (!parts[0]) return undefined
  return parts[0].startsWith('@') ? `${parts[0]}/${parts[1] ?? ''}` : parts[0]
}

function matchesPackage(packageName: string, candidate: string) {
  return packageName === candidate || packageName.startsWith(`${candidate}/`)
}

/**
 * Rollup manualChunks strategy: keep stable app vendors cacheable, and isolate
 * heavyweight feature libraries behind the lazy routes/actions that use them.
 * Excalidraw, Mermaid, and PDF export intentionally keep Rollup's own dynamic
 * imports because forcing them together creates multi-megabyte editor chunks.
 */
export function resolveManualChunk(id: string): string | undefined {
  const packageName = packageNameFromId(id)
  if (!packageName) return undefined

  for (const [chunk, packages] of CHUNK_MATCHERS) {
    if (packages.some((candidate) => matchesPackage(packageName, candidate))) {
      return chunk
    }
  }

  return undefined
}
