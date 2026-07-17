import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { GitCommit, GitPullRequest, CircleDot, ExternalLink, Trash2 } from 'lucide-react'

import { useCallback, useState } from 'react'



import { GitHubIcon } from '../icons/brands'

import { api, errorMessage } from '../../lib/api'

import { startGithubOAuth } from '../../lib/githubOAuth'

import { EXTERNAL_LINK_REL, safeGithubUrl } from '../../lib/safeUrl'

import type { GithubEvent, Page } from '../../lib/types'

import { timeAgo } from '../../lib/utils'

import { useRealtime } from '../../lib/ws'

import { useAuthStore } from '../../stores/auth'

import { toast } from '../../stores/toast'

import { CenteredSpinner } from '../ui/Spinner'



interface ConnectionStatus {

  connected: boolean

  github_user_login: string | null

  needs_reconnect?: boolean

  can_connect?: boolean

  can_disconnect?: boolean

  can_link_repo?: boolean

  connected_by?: string | null

}



interface AvailableRepo {

  repo_id: number

  repo_full_name: string

  default_branch: string

  private: boolean

}



interface LinkedRepo {

  id: string

  repo_full_name: string

  is_active: boolean

  connected_by: string | null

}



function eventIcon(event: GithubEvent) {

  if (event.event_type === 'pull_request') return <GitPullRequest size={15} className="text-brand" />

  if (event.event_type === 'issues') return <CircleDot size={15} className="text-emerald-400" />

  return <GitCommit size={15} className="text-sky-400" />

}



export function GithubFeed({ projectId }: { projectId: string }) {

  const queryClient = useQueryClient()

  const userId = useAuthStore((s) => s.user?.id)

  const [selectedRepo, setSelectedRepo] = useState('')



  const syncProjectGithub = useCallback(async () => {

    await Promise.all([

      queryClient.refetchQueries({ queryKey: ['gh-proj-conn', projectId] }),

      queryClient.refetchQueries({ queryKey: ['gh-proj-repos', projectId] }),

      queryClient.refetchQueries({ queryKey: ['gh-available-repos', projectId] }),

      queryClient.refetchQueries({ queryKey: ['github-events', projectId] }),

      queryClient.refetchQueries({ queryKey: ['project-repos', projectId] }),

    ])

  }, [projectId, queryClient])



  const conn = useQuery({

    queryKey: ['gh-proj-conn', projectId],

    queryFn: () => api.get<ConnectionStatus>(`/github/projects/${projectId}/connection`),

    staleTime: 0,

    refetchOnMount: 'always',

  })



  const linkedRepos = useQuery({

    queryKey: ['gh-proj-repos', projectId],

    queryFn: () => api.get<LinkedRepo[]>(`/github/projects/${projectId}/repositories`),

    staleTime: 0,

    refetchOnMount: 'always',

  })



  const canLinkRepo = conn.data?.can_link_repo === true

  const availableRepos = useQuery({

    queryKey: ['gh-available-repos', projectId],

    queryFn: () => api.get<AvailableRepo[]>(`/github/projects/${projectId}/available-repos`),

    enabled: conn.data?.connected === true && canLinkRepo,

    staleTime: 0,

  })



  const { data, isLoading } = useQuery({

    queryKey: ['github-events', projectId],

    queryFn: async () => {
      try {
        await api.post<{ imported: number }>(`/github/projects/${projectId}/sync-issues`)
        void queryClient.invalidateQueries({ queryKey: ['tasks', projectId] })
      } catch {
        /* non-fatal */
      }
      return api.get<Page<GithubEvent>>(`/github/projects/${projectId}/events?page_size=50`)
    },

  })



  const connectRepo = useMutation({

    mutationFn: () => api.post(`/github/projects/${projectId}/connect-repo`, { repo_full_name: selectedRepo }),

    onSuccess: () => {

      toast.success('Repository linked')

      setSelectedRepo('')

      void syncProjectGithub()

    },

    onError: (err) => toast.error(errorMessage(err)),

  })



  const unlinkRepo = useMutation({

    mutationFn: (repoId: string) => api.delete(`/github/repositories/${repoId}`),

    onSuccess: () => {

      toast.success('Repository unlinked')

      void syncProjectGithub()

    },

    onError: (err) => toast.error(errorMessage(err)),

  })



  useRealtime(

    'github.event.created',

    (event) => {

      if (event.project_id === projectId) {

        void queryClient.invalidateQueries({ queryKey: ['github-events', projectId] })

      }

    },

    [projectId, queryClient],

  )



  if (isLoading || linkedRepos.isLoading || conn.isLoading) return <CenteredSpinner />



  const events = data?.items ?? []

  const reposList = Array.isArray(linkedRepos.data) ? linkedRepos.data : []
  const activeRepo = reposList.find((r) => r.is_active) ?? null

  const projConnected = conn.data?.connected === true

  const canConnect = conn.data?.can_connect === true

  const canDisconnect = conn.data?.can_disconnect === true

  const projectConnectorId = conn.data?.connected_by ?? null
  const canUnlink = (connectedBy: string | null | undefined) => {
    if (!userId) return false
    const linker = connectedBy ?? projectConnectorId
    return !!linker && String(linker) === String(userId)
  }

  const repoOptions = (Array.isArray(availableRepos.data) ? availableRepos.data : []).filter(

    (r) => r.repo_full_name !== activeRepo?.repo_full_name,

  )



  return (

    <div className="mx-auto max-w-3xl space-y-5 px-6 py-5">

      {!projConnected ? (

        <div className="flex items-center justify-between rounded-xl border border-ink-700 bg-ink-900 px-4 py-3">

          <div>

            <p className="text-sm font-medium text-fg">
              {conn.data?.needs_reconnect ? 'Reconnect GitHub for this project' : 'GitHub not connected for this project'}
            </p>

            <p className="text-xs text-fg-muted">
              {conn.data?.needs_reconnect
                ? 'The project GitHub token expired or was revoked. Reconnect to restore repo sync and task actions.'
                : 'Connect a shared GitHub account to link a repository and stream activity.'}
            </p>

          </div>

          {canConnect ? (

            <button

              className="btn-primary !py-1.5 text-xs"

              onClick={() => void startGithubOAuth({ type: 'project', projectId })}

            >

              {conn.data?.needs_reconnect ? 'Reconnect' : 'Connect GitHub'}

            </button>

          ) : (

            <span className="shrink-0 text-xs text-fg-muted">Ask a project admin</span>

          )}

        </div>

      ) : (

        <div className="flex items-center gap-3 rounded-xl border border-emerald-800/60 bg-emerald-950/30 px-4 py-3">

          <GitHubIcon size={15} className="shrink-0 text-emerald-400" />

          <span className="flex-1 text-sm text-fg">

            Connected as <span className="font-medium">{conn.data?.github_user_login}</span>

          </span>

          {canDisconnect && (

            <button

              className="text-xs text-fg-muted hover:text-red-400"

              onClick={async () => {

                try {

                  await api.delete(`/github/projects/${projectId}/connection`)

                  toast.success('Project GitHub disconnected')

                  void syncProjectGithub()

                } catch (err) {

                  toast.error(errorMessage(err))

                }

              }}

            >

              Disconnect

            </button>

          )}

        </div>

      )}



      <section>

        <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-fg-muted">Linked repository</p>

        {!projConnected ? (

          <p className="text-xs text-fg-muted">Connect GitHub to link a repository.</p>

        ) : activeRepo ? (

          <div className="flex items-center gap-2 rounded-lg border border-ink-700 bg-ink-900 px-3 py-2">

            <GitHubIcon size={13} className="shrink-0 text-fg-secondary" />

            <span className="min-w-0 flex-1 truncate text-sm text-fg">{activeRepo.repo_full_name}</span>

            {canUnlink(activeRepo.connected_by) && (

              <button

                className="text-fg-muted hover:text-red-400"

                title="Unlink repository"

                disabled={unlinkRepo.isPending}

                onClick={() => unlinkRepo.mutate(activeRepo.id)}

              >

                <Trash2 size={13} />

              </button>

            )}

          </div>

        ) : canLinkRepo ? (

          <div className="flex gap-2">

            <select

              className="input-dark flex-1"

              value={selectedRepo}

              onChange={(e) => setSelectedRepo(e.target.value)}

              disabled={availableRepos.isLoading}

            >

              <option value="">{availableRepos.isLoading ? 'Loading repositories…' : 'Select a repository'}</option>

              {repoOptions.map((r) => (

                <option key={r.repo_id} value={r.repo_full_name}>

                  {r.private ? '🔒 ' : ''}{r.repo_full_name}

                </option>

              ))}

            </select>

            <button

              className="btn-primary !px-4 text-xs"

              disabled={!selectedRepo || connectRepo.isPending}

              onClick={() => connectRepo.mutate()}

            >

              Link

            </button>

          </div>

        ) : (

          <p className="text-xs text-fg-muted">No repository linked for this project.</p>

        )}

      </section>



      {events.length > 0 ? (
        <div className="space-y-1">

          {activeRepo ? (

            <p className="mb-3 text-xs font-semibold uppercase tracking-wider text-fg-muted">

              Activity · {activeRepo.repo_full_name}

            </p>

          ) : null}

          {events.map((event) => (

            <div key={event.id} className="flex items-start gap-3 rounded-lg px-3 py-2.5 transition-colors hover:bg-ink-850">

              <div className="mt-0.5">{eventIcon(event)}</div>

              <div className="min-w-0 flex-1">

                <p className="text-sm text-fg">

                  {(event.payload.summary as string) || `${event.event_type} ${event.action ?? ''}`}

                </p>

                <p className="text-[11px] text-fg-muted">

                  {event.payload.repo as string} · {event.actor_login} · {timeAgo(event.created_at)}

                </p>

              </div>

              {event.payload.url ? (

                <a

                  href={safeGithubUrl(event.payload.url as string) ?? undefined}

                  target="_blank"

                  rel={EXTERNAL_LINK_REL}

                  className="btn-ghost !px-2 !py-1"

                >

                  <ExternalLink size={13} />

                </a>

              ) : null}

            </div>

          ))}

        </div>
      ) : null}

    </div>

  )

}


