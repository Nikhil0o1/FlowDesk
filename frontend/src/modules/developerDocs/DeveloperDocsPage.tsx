import { useQuery } from '@tanstack/react-query'
import { BookOpen, Menu, X } from 'lucide-react'
import { useMemo, useState } from 'react'
import { Link, Navigate, useParams } from 'react-router-dom'

import { api } from '../../lib/api'
import type { ApiTokenMeta } from '../../lib/apiKeys'
import { cn } from '../../lib/utils'
import { DocsArticle } from './DocsArticle'
import { DOCS_LAST_UPDATED, DOCS_NAV, type DocsSlug } from './nav'

const VALID = new Set(DOCS_NAV.map((n) => n.slug))

export default function DeveloperDocsPage() {
  const { slug: rawSlug } = useParams()
  const slug = (rawSlug || 'overview') as DocsSlug
  const [mobileNav, setMobileNav] = useState(false)

  const metaQuery = useQuery({
    queryKey: ['api-token-meta'],
    queryFn: () => api.get<ApiTokenMeta>('/users/me/api-tokens/meta'),
    staleTime: 60_000,
  })

  const groups = useMemo(() => {
    const map = new Map<string, typeof DOCS_NAV>()
    for (const item of DOCS_NAV) {
      const list = map.get(item.group) ?? []
      list.push(item)
      map.set(item.group, list)
    }
    return [...map.entries()]
  }, [])

  if (rawSlug && !VALID.has(slug)) {
    return <Navigate to="/app/developers/overview" replace />
  }

  const outline = DOCS_NAV.find((n) => n.slug === slug)

  return (
    // Absolute fill avoids h-full % height failures that inflate outer scroll.
    <div className="absolute inset-0 flex min-h-0 overflow-hidden bg-ink-900">
      <aside
        className={cn(
          'flex h-full w-64 shrink-0 flex-col border-r border-ink-700 bg-ink-850',
          mobileNav ? 'absolute inset-y-0 left-0 z-30 shadow-popover' : 'hidden lg:flex',
        )}
      >
        <div className="flex shrink-0 items-center justify-between border-b border-ink-700 px-4 py-3">
          <div className="flex items-center gap-2 text-sm font-semibold text-fg">
            <BookOpen size={16} />
            Developer Docs
          </div>
          <button
            type="button"
            className="btn-ghost p-1 lg:hidden"
            aria-label="Close documentation navigation"
            onClick={() => setMobileNav(false)}
          >
            <X size={16} />
          </button>
        </div>
        <nav className="min-h-0 flex-1 overflow-y-auto px-3 py-3" aria-label="Developer documentation">
          {groups.map(([group, items]) => (
            <div key={group} className="mb-4">
              <p className="px-2 text-[11px] font-semibold uppercase tracking-wide text-fg-muted">
                {group}
              </p>
              <ul className="mt-1 space-y-0.5">
                {items.map((item) => (
                  <li key={item.slug}>
                    <Link
                      to={`/app/developers/${item.slug}`}
                      onClick={() => setMobileNav(false)}
                      className={cn(
                        'block rounded-lg px-2 py-1.5 text-sm',
                        slug === item.slug
                          ? 'bg-brand/15 font-medium text-fg'
                          : 'text-fg-secondary hover:bg-ink-800 hover:text-fg',
                      )}
                    >
                      {item.label}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </nav>
        <div className="shrink-0 border-t border-ink-700 px-4 py-3 text-xs text-fg-muted">
          API v{metaQuery.data?.api_version ?? '1.0.0'} · Updated {DOCS_LAST_UPDATED}
        </div>
      </aside>

      <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
        <div className="flex shrink-0 items-center gap-2 border-b border-ink-700 px-4 py-2 lg:hidden">
          <button
            type="button"
            className="btn-ghost p-2"
            aria-label="Open documentation navigation"
            onClick={() => setMobileNav(true)}
          >
            <Menu size={18} />
          </button>
          <span className="text-sm text-fg">{outline?.label ?? 'Docs'}</span>
        </div>

        <div className="flex min-h-0 flex-1 overflow-hidden">
          <main className="min-h-0 min-w-0 flex-1 overflow-y-auto overscroll-contain px-4 py-6 sm:px-8">
            <div className="mx-auto max-w-3xl pb-8">
              <DocsArticle slug={slug} meta={metaQuery.data} />
              <div className="mt-10 border-t border-ink-700 pt-4 text-xs text-fg-muted">
                <Link to="/app/settings?tab=api-keys" className="text-brand hover:underline">
                  Manage OAuth apps &amp; API keys
                </Link>
                {' · '}
                Prefer OAuth apps for multi-user integrations; least-privilege scopes for personal tokens.
              </div>
            </div>
          </main>

          <aside className="hidden h-full w-48 shrink-0 overflow-y-auto border-l border-ink-700 p-4 xl:block">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-fg-muted">On this page</p>
            <p className="mt-2 text-xs text-fg-secondary">{outline?.label}</p>
            <p className="mt-4 text-xs text-fg-muted">
              Identity: user-bound. Resource restrictions: not available.
            </p>
          </aside>
        </div>
      </div>

      {mobileNav && (
        <button
          type="button"
          className="fixed inset-0 z-20 bg-black/50 lg:hidden"
          aria-label="Dismiss documentation navigation"
          onClick={() => setMobileNav(false)}
        />
      )}
    </div>
  )
}
