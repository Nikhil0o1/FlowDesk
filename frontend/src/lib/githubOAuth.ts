import { useEffect } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { useSearchParams } from 'react-router-dom'

import { api, errorMessage } from './api'
import { safeGithubOAuthUrl } from './safeUrl'
import { toast } from '../stores/toast'

/** Path under /app to return to after GitHub OAuth (includes query string). */
export function githubOAuthReturnPath(): string {
  const { pathname, search } = window.location
  if (pathname.startsWith('/app/')) {
    const rel = pathname.slice('/app/'.length) + search
    return rel || 'apps?app=github'
  }
  return 'apps?app=github'
}

export type GithubOAuthStart =
  | { type: 'personal'; orgId: string }
  | { type: 'project'; projectId: string }

/** Begin GitHub OAuth; user returns to the current page after authorizing. */
export async function startGithubOAuth(params: GithubOAuthStart): Promise<void> {
  const next = encodeURIComponent(githubOAuthReturnPath())
  const qs =
    params.type === 'project'
      ? `type=project&project_id=${params.projectId}`
      : `type=personal&org_id=${params.orgId}`
  try {
    const { url } = await api.get<{ url: string }>(`/github/oauth/authorize?${qs}&next=${next}`)
    const safe = safeGithubOAuthUrl(url)
    if (!safe) {
      toast.error('Invalid authorization URL from server')
      return
    }
    window.location.href = safe
  } catch (err) {
    toast.error(errorMessage(err))
  }
}

const GITHUB_QUERY_ROOTS = ['gh-personal', 'gh-proj-conn', 'gh-available-repos', 'gh-proj-repos', 'github-events', 'gh-personal-links', 'project-repos'] as const

function invalidateGithubQueries(queryClient: ReturnType<typeof useQueryClient>) {
  for (const key of GITHUB_QUERY_ROOTS) {
    void queryClient.invalidateQueries({ queryKey: [key] })
  }
}

/** Handle ?github_connected=1 / ?github_error=1 on any /app page after OAuth redirect. */
export function useGithubOAuthCallback() {
  const [params, setParams] = useSearchParams()
  const queryClient = useQueryClient()

  useEffect(() => {
    const connected = params.get('github_connected') === '1'
    const errored = params.get('github_error') === '1'
    if (!connected && !errored) return

    if (connected) {
      toast.success('GitHub connected successfully!')
      invalidateGithubQueries(queryClient)
    } else {
      toast.error('GitHub connection failed. Please try again.')
    }

    const next = new URLSearchParams(params)
    next.delete('github_connected')
    next.delete('github_error')
    setParams(next, { replace: true })
    // eslint-disable-next-line react-hooks/exhaustive-deps -- run once on landing from OAuth redirect
  }, [])
}
