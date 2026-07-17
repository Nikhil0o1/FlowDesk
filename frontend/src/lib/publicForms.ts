import { API_BASE } from './env'
import type { PublicForm } from './types'

/** Public fill URL served by the SPA (no auth). */
export function publicFormUrl(publicToken: string): string {
  return `${window.location.origin}/f/${publicToken}`
}

export type EmbedOptions = {
  /** Use min-height instead of a fixed iframe height. */
  autosize?: boolean
  height?: number
}

/** HTML snippet to embed the public form on an external site. */
export function publicFormEmbedCode(publicToken: string, opts: EmbedOptions = {}): string {
  const src = publicFormUrl(publicToken)
  const height = opts.height ?? 600
  const style = opts.autosize
    ? 'border:0;width:100%;min-height:480px'
    : `border:0;width:100%;height:${height}px`
  return `<iframe src="${src}" style="${style}" loading="lazy" title="Form"></iframe>`
}

async function readJsonBody(res: Response): Promise<unknown> {
  const text = await res.text()
  try {
    return JSON.parse(text)
  } catch {
    if (text.trimStart().startsWith('<')) {
      throw new Error(
        'Could not reach the form API. If you are deploying the UI, ensure VITE_API_URL points to the backend.',
      )
    }
    throw new Error('Unexpected response from server')
  }
}

/**
 * Public form API calls intentionally skip the authenticated `api` client so
 * logged-in workspace members get the same access as anonymous visitors.
 */
async function publicRequest<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    method,
    credentials: 'omit',
    headers: body !== undefined ? { 'Content-Type': 'application/json' } : undefined,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  })
  const data = await readJsonBody(res)
  if (!res.ok) {
    const detail = (data as { detail?: string })?.detail
    throw new Error(typeof detail === 'string' ? detail : 'Request failed')
  }
  return data as T
}

/** Load a public form definition (no auth). */
export async function fetchPublicForm(token: string): Promise<PublicForm> {
  return publicRequest<PublicForm>('GET', `/public/forms/${encodeURIComponent(token)}`)
}

/** Submit a public form (no auth). */
export async function submitPublicForm(
  token: string,
  body: { values: Record<string, string>; submitter_email?: string | null },
): Promise<void> {
  await publicRequest('POST', `/public/forms/${encodeURIComponent(token)}`, body)
}

/** Copy the public form URL to the clipboard. Returns the URL copied. */
export async function copyPublicFormLink(publicToken: string): Promise<string> {
  const url = publicFormUrl(publicToken)
  await navigator.clipboard.writeText(url)
  return url
}
