import { describe, expect, it } from 'vitest'

import { resolveManualChunk } from '@/lib/build/manualChunks'

describe('resolveManualChunk', () => {
  it('returns undefined for application code', () => {
    expect(resolveManualChunk('/src/lib/utils.ts')).toBeUndefined()
  })

  it('groups react ecosystem into vendor-react', () => {
    expect(resolveManualChunk('/node_modules/react/index.js')).toBe('vendor-react')
    expect(resolveManualChunk('/node_modules/react-dom/client.js')).toBe('vendor-react')
    expect(resolveManualChunk('/node_modules/react-router-dom/index.js')).toBe('vendor-react')
  })

  it('groups tanstack, lucide, and zustand separately', () => {
    expect(resolveManualChunk('/node_modules/@tanstack/react-query/build/modern/index.js')).toBe(
      'vendor-query',
    )
    expect(resolveManualChunk('/node_modules/lucide-react/dist/esm/icons/check.js')).toBe(
      'vendor-icons',
    )
    expect(resolveManualChunk('/node_modules/zustand/esm/index.mjs')).toBe('vendor-state')
  })

  it('returns undefined for other node_modules', () => {
    expect(resolveManualChunk('/node_modules/jspdf/dist/jspdf.es.min.js')).toBeUndefined()
  })
})
