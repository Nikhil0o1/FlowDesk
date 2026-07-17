export type DocsSlug =
  | 'overview'
  | 'quickstart'
  | 'authentication'
  | 'oauth-apps'
  | 'scopes'
  | 'api-reference'
  | 'errors'
  | 'rate-limits'
  | 'pagination'
  | 'key-rotation'
  | 'webhooks'
  | 'realtime'
  | 'examples'
  | 'versioning'

export const DOCS_NAV: { slug: DocsSlug; label: string; group: string }[] = [
  { slug: 'overview', label: 'Overview', group: 'Start' },
  { slug: 'quickstart', label: 'Quickstart', group: 'Start' },
  { slug: 'authentication', label: 'Authentication', group: 'Core' },
  { slug: 'oauth-apps', label: 'OAuth Apps', group: 'Core' },
  { slug: 'scopes', label: 'Scopes', group: 'Core' },
  { slug: 'api-reference', label: 'API Reference', group: 'Core' },
  { slug: 'errors', label: 'Errors', group: 'Core' },
  { slug: 'rate-limits', label: 'Rate Limits', group: 'Core' },
  { slug: 'pagination', label: 'Pagination & Filtering', group: 'Core' },
  { slug: 'key-rotation', label: 'Key & Secret Rotation', group: 'Guides' },
  { slug: 'webhooks', label: 'Webhooks', group: 'Guides' },
  { slug: 'realtime', label: 'Realtime (WebSockets)', group: 'Guides' },
  { slug: 'examples', label: 'Code Examples', group: 'Guides' },
  { slug: 'versioning', label: 'Versioning', group: 'Policy' },
]

export const DOCS_LAST_UPDATED = '2026-07-17'
