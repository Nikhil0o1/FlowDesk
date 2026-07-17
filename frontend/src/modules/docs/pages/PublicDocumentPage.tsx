import { useQuery } from '@tanstack/react-query'
import { useParams } from 'react-router-dom'

import { PublicBreadcrumbBar } from '../../../components/navigation/PublicBreadcrumbBar'
import { cn, timeAgo } from '../../../lib/utils'
import { fetchPublicDocument } from '../services/docsApi.service'
import {
  pageFocusClasses,
  pageSettingsTypography,
  pageSettingsWidth,
} from '../components/DocPage/PageStylesPanel'
import { DEFAULT_PAGE_SETTINGS, type DocPageSettings } from '../types/pageSettings'

/** Public, read-only document view served from a share token (no auth). */
export default function PublicDocumentPage() {
  const { token } = useParams<{ token: string }>()
  const { data: doc, isLoading, isError } = useQuery({
    queryKey: ['public-document', token],
    queryFn: () => fetchPublicDocument(token!),
    enabled: !!token,
    retry: false,
  })

  if (isLoading) return <div className="grid min-h-screen place-items-center text-fg-muted">Loading…</div>
  if (isError || !doc) {
    return (
      <div className="grid min-h-screen place-items-center px-6 text-center">
        <p className="text-sm text-fg-secondary">
          This document isn't available. The share link may have been turned off or expired.
        </p>
      </div>
    )
  }

  const pageSettings: DocPageSettings = {
    ...DEFAULT_PAGE_SETTINGS,
    ...(doc.pageSettings as Partial<DocPageSettings> | undefined),
  }
  const typography = pageSettingsTypography(pageSettings)
  const widthClass = pageSettingsWidth(pageSettings)
  const focusModeClass = pageFocusClasses(pageSettings)
  const showCover = pageSettings.showCover !== false && !!doc.coverUrl

  return (
    <div className="min-h-screen bg-ink-950 px-4 py-10">
      <div className="mx-auto max-w-3xl">
        <PublicBreadcrumbBar
          items={[{ label: 'Shared document' }, { label: doc.title, current: true }]}
        />
      </div>
      <div className={cn('mx-auto rounded-2xl border border-ink-700 bg-ink-900', widthClass === 'max-w-4xl' ? 'max-w-4xl' : widthClass === 'max-w-2xl' ? 'max-w-2xl' : 'max-w-3xl')}>
        {showCover && (
          <div
            className="h-40 rounded-t-2xl bg-cover bg-center"
            style={{ backgroundImage: `url(${doc.coverUrl})` }}
            role="img"
            aria-label="Document cover"
          />
        )}
        <div className={cn('p-8', focusModeClass)}>
          {doc.icon && pageSettings.showPageIcon && (
            <div className="text-4xl leading-none">{doc.icon}</div>
          )}
          <h1 className={cn('text-3xl font-bold text-fg', doc.icon && pageSettings.showPageIcon ? 'mt-2' : '')}>
            {doc.title}
          </h1>
          <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-fg-muted">
            <span>By {doc.author}</span>
            <span aria-hidden>·</span>
            <span>Updated {timeAgo(doc.updatedAt)}</span>
            {doc.isWiki && (
              <>
                <span aria-hidden>·</span>
                <span>Wiki</span>
              </>
            )}
          </div>
          {pageSettings.showSubtitle && pageSettings.subtitle && (
            <p className="mt-2 text-lg text-fg-muted">{pageSettings.subtitle}</p>
          )}
          <div
            className={cn('docs-content mt-6 border-t border-ink-700 pt-6', typography)}
            dangerouslySetInnerHTML={{ __html: doc.content || '<p class="text-fg-muted">This document is empty.</p>' }}
          />
          <p className="mt-8 text-center text-[11px] text-fg-muted">Shared read-only via FlowDesk</p>
        </div>
      </div>
    </div>
  )
}
