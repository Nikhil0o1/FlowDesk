import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { CheckCircle2, Plus, Search, Trash2 } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'

import {
  GitHubIcon,
  GmailIcon,
  GoogleCalendarIcon,
  GoogleDocsIcon,
  GoogleSheetsIcon,
} from '../../components/icons/brands'

import { api, errorMessage } from '../../lib/api'
import { useCurrentContext, useProjects } from '../../lib/queries'
import { toast } from '../../stores/toast'
import { Modal } from '../../components/ui/Modal'

interface OAuthStatus {
  connected: boolean
  github_user_login: string | null
}

interface AvailableRepo {
  repo_id: number
  repo_full_name: string
  default_branch: string
  private: boolean
}

interface Repository {
  id: string
  installation_id: string
  project_id: string | null
  workspace_id: string | null
  repo_id: number
  repo_full_name: string
  is_active: boolean
  created_at: string
}

interface GoogleStatus {
  configured: boolean
  connected: boolean
  account_email: string | null
  scopes: { calendar: boolean; gmail_send: boolean; gmail_read: boolean; sheets: boolean }
}

export default function AppCenterPage() {
  const [params, setParams] = useSearchParams()
  const navigate = useNavigate()
  const app = params.get('app')
  const [q, setQ] = useState(params.get('q') ?? '')

  // Handle GitHub OAuth callback redirects
  useEffect(() => {
    if (params.get('github_connected') === '1') {
      toast.success('GitHub connected successfully!')
      params.delete('github_connected')
      params.set('app', 'github')
      setParams(params, { replace: true })
    }
    if (params.get('github_error') === '1') {
      toast.error('GitHub connection failed. Please try again.')
      params.delete('github_error')
      setParams(params, { replace: true })
    }
  }, [])

  // Sidebar items deep-link with ?q=<app name>
  useEffect(() => {
    setQ(params.get('q') ?? '')
  }, [params])

  const googleStatus = useQuery({
    queryKey: ['google-status'],
    queryFn: () => api.get<GoogleStatus>('/integrations/google/status'),
  })
  const s = googleStatus.data?.scopes

  // Google tiles share ONE OAuth connection — one consent enables all of them.
  const apps: {
    key: string
    name: string
    icon: React.ReactNode
    description: string
    benefits?: string[]
    action: React.ReactNode
  }[] = [
    {
      key: 'github',
      name: 'GitHub',
      icon: <GitHubIcon size={24} className="text-white" />,
      description: 'Bring your code activity into the project it belongs to.',
      benefits: [
        'Pushes, PRs and issues stream into the project feed and the linked task’s Development panel',
        'PHX-12[In Review] in a commit or PR moves the task to that status',
        'PR opened → task moves to review; PR merged → task is completed (and people are notified)',
        'Copy a ready-made branch name or open a pre-filled GitHub issue from any task',
      ],
      action: (
        <button
          className="btn-primary !py-1.5 text-xs"
          onClick={() => {
            params.set('app', 'github')
            setParams(params, { replace: true })
          }}
        >
          Manage connection
        </button>
      ),
    },
    {
      key: 'gcal',
      name: 'Google Calendar',
      icon: <GoogleCalendarIcon size={24} />,
      description: 'Your schedule and your deadlines in one place.',
      benefits: [
        'Planner shows your real meetings beside tasks due this week',
        'Push any task’s due date to your calendar from the task page',
        'Never double-book a deadline against a client call',
      ],
      action: (
        <GoogleFeatureAction
          status={googleStatus.data}
          ok={!!s?.calendar}
          openLabel="Open Planner"
          onOpen={() => navigate('/app/planner')}
        />
      ),
    },
    {
      key: 'gmail',
      name: 'Gmail',
      icon: <GmailIcon size={24} />,
      description: 'Your inbox and your tasks, no tab switching.',
      benefits: [
        'Invitations you send go out from your own Gmail address',
        'Every task page shows the emails that mention its ref (e.g. PHX-12)',
        'Jump from a task straight to the email thread in Gmail',
      ],
      action: (
        <GoogleFeatureAction
          status={googleStatus.data}
          ok={!!s?.gmail_send && !!s?.gmail_read}
          openLabel="See it on your tasks"
          onOpen={() => navigate('/app/list')}
        />
      ),
    },
    {
      key: 'gsheets',
      name: 'Google Sheets',
      icon: <GoogleSheetsIcon size={24} />,
      description: 'Manage projects from a spreadsheet — both directions.',
      benefits: [
        'Two-way sync: edit status, priority or due dates in the sheet and FlowDesk follows',
        'Add a row to the sheet and it becomes a FlowDesk task automatically',
        'Client-ready time reports: tracked hours with totals by user and task',
        'Share the synced sheet with stakeholders who don’t have FlowDesk accounts',
      ],
      action: (
        <GoogleFeatureAction
          status={googleStatus.data}
          ok={!!s?.sheets}
          openLabel="Open a project"
          onOpen={() => navigate('/app/workspaces')}
        />
      ),
    },
    {
      key: 'gdocs',
      name: 'Google Docs',
      icon: <GoogleDocsIcon size={24} />,
      description: 'Attach and preview Docs on tasks.',
      action: (
        <span className="inline-flex items-center gap-1.5 rounded-lg bg-ink-750 px-2.5 py-1.5 text-xs text-fg-muted">
          Coming soon
        </span>
      ),
    },
  ].filter((a) => !q.trim() || a.name.toLowerCase().includes(q.trim().toLowerCase()))

  return (
    <div className="mx-auto max-w-4xl px-8 py-7">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-fg">App Center</h1>
          <p className="mt-0.5 text-sm text-fg-secondary">Connect the tools your team already uses.</p>
        </div>
        <div className="relative">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-fg-muted" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search…" className="input-dark !w-56 !pl-9" />
        </div>
      </div>

      <h2 className="mb-3 mt-7 text-sm font-semibold text-fg">Featured</h2>
      <div className="grid grid-cols-2 gap-4 max-md:grid-cols-1">
        {apps.map((appDef) => (
          <div key={appDef.key} className="flex items-start gap-4 rounded-2xl border border-ink-700 bg-ink-850/60 p-5">
            <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-ink-800">
              {appDef.icon}
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold text-fg">{appDef.name}</p>
              <p className="mt-0.5 text-xs leading-relaxed text-fg-secondary">{appDef.description}</p>
              {appDef.benefits && (
                <ul className="mt-2 space-y-1">
                  {appDef.benefits.map((b) => (
                    <li key={b} className="flex items-start gap-1.5 text-[11px] leading-relaxed text-fg-muted">
                      <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-brand" />
                      {b}
                    </li>
                  ))}
                </ul>
              )}
              <div className="mt-3">{appDef.action}</div>
            </div>
          </div>
        ))}
        {apps.length === 0 && <p className="col-span-2 py-8 text-center text-sm text-fg-muted">No apps match “{q}”.</p>}
      </div>

      <GitHubPanel open={app === 'github'} onClose={() => { params.delete('app'); setParams(params, { replace: true }) }} />
    </div>
  )
}

/** Action area for one Google tile. All tiles share the same connection:
 *  one consent grants every scope, so Connect/Re-connect is the same flow. */
function GoogleFeatureAction({
  status,
  ok,
  openLabel,
  onOpen,
}: {
  status: GoogleStatus | undefined
  ok: boolean
  openLabel?: string
  onOpen?: () => void
}) {
  const queryClient = useQueryClient()

  const connect = async () => {
    try {
      const { url } = await api.get<{ url: string }>('/calendar/google/auth-url?next=apps')
      window.location.href = url
    } catch (err) {
      toast.error(errorMessage(err))
    }
  }

  const disconnect = async () => {
    try {
      await api.delete('/calendar/google')
      toast.success('Google account disconnected')
      void queryClient.invalidateQueries({ queryKey: ['google-status'] })
    } catch (err) {
      toast.error(errorMessage(err))
    }
  }

  if (!status) return null
  if (!status.configured) {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-lg bg-ink-750 px-2.5 py-1.5 text-xs text-fg-muted">
        Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET in the root .env
      </span>
    )
  }
  if (!status.connected) {
    return (
      <button className="btn-primary !py-1.5 text-xs" onClick={() => void connect()} title="One approval connects Calendar, Gmail and Sheets together">
        Connect Google account
      </button>
    )
  }
  if (!ok) {
    return (
      <button className="btn-secondary !py-1.5 text-xs" onClick={() => void connect()}>
        Re-connect to grant access
      </button>
    )
  }
  return (
    <div className="flex flex-wrap items-center gap-3">
      {openLabel && onOpen && (
        <button className="btn-primary !py-1.5 text-xs" onClick={onOpen}>
          {openLabel}
        </button>
      )}
      <span className="flex items-center gap-1.5 text-xs text-emerald-400">
        <CheckCircle2 size={13} /> Connected as {status.account_email}
      </span>
      <button
        className="text-xs text-fg-muted hover:text-red-400"
        title="Disconnects Calendar, Gmail and Sheets together"
        onClick={() => void disconnect()}
      >
        Disconnect
      </button>
    </div>
  )
}

function GitHubPanel({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { org, workspace } = useCurrentContext()
  const projects = useProjects(workspace?.id)
  const queryClient = useQueryClient()

  const oauthStatus = useQuery({
    queryKey: ['gh-oauth-status', org?.id],
    queryFn: () => api.get<OAuthStatus>(`/github/organizations/${org!.id}/oauth-status`),
    enabled: open && !!org,
  })

  const availableRepos = useQuery({
    queryKey: ['gh-available-repos', org?.id],
    queryFn: () => api.get<AvailableRepo[]>(`/github/organizations/${org!.id}/available-repos`),
    enabled: open && !!org && oauthStatus.data?.connected === true,
  })

  const connectedRepos = useQuery({
    queryKey: ['gh-repos', workspace?.id, projects.data?.map((p) => p.id).join(',')],
    queryFn: async () => {
      const all: (Repository & { project_name: string })[] = []
      for (const project of projects.data ?? []) {
        const repos = await api.get<Repository[]>(`/github/projects/${project.id}/repositories`)
        for (const repo of repos) all.push({ ...repo, project_name: project.name })
      }
      return all
    },
    enabled: open && (projects.data ?? []).length > 0,
  })

  const [selectedRepo, setSelectedRepo] = useState('')
  const [selectedProject, setSelectedProject] = useState('')

  const connectRepo = useMutation({
    mutationFn: () =>
      api.post(`/github/organizations/${org!.id}/connect-repo`, {
        repo_full_name: selectedRepo,
        project_id: selectedProject || projects.data?.[0]?.id,
      }),
    onSuccess: () => {
      toast.success('Repository connected')
      setSelectedRepo('')
      void queryClient.invalidateQueries({ queryKey: ['gh-repos'] })
    },
    onError: (err) => toast.error(errorMessage(err)),
  })

  const disconnectRepo = async (repoId: string) => {
    try {
      await api.delete(`/github/repositories/${repoId}`)
      toast.success('Repository disconnected')
      void queryClient.invalidateQueries({ queryKey: ['gh-repos'] })
    } catch (err) {
      toast.error(errorMessage(err))
    }
  }

  const disconnectGitHub = useMutation({
    mutationFn: () => api.delete(`/github/oauth/disconnect?org_id=${org!.id}`),
    onSuccess: () => {
      toast.success('GitHub disconnected')
      void queryClient.invalidateQueries({ queryKey: ['gh-oauth-status'] })
      void queryClient.invalidateQueries({ queryKey: ['gh-repos'] })
    },
    onError: (err) => toast.error(errorMessage(err)),
  })

  const startOAuth = async () => {
    try {
      const { url } = await api.get<{ url: string }>(`/github/oauth/authorize?org_id=${org!.id}`)
      window.location.href = url
    } catch (err) {
      toast.error(errorMessage(err))
    }
  }

  const isConnected = oauthStatus.data?.connected === true
  const activeRepos = (connectedRepos.data ?? []).filter((r) => r.is_active)
  const alreadyConnectedNames = new Set(activeRepos.map((r) => r.repo_full_name))
  const repoOptions = (availableRepos.data ?? []).filter((r) => !alreadyConnectedNames.has(r.repo_full_name))

  return (
    <Modal open={open} onClose={onClose} title="GitHub" width="max-w-lg">
      <div className="space-y-6">

        {/* Step 1 — Connect GitHub account */}
        <section>
          <p className="mb-1 text-xs font-semibold uppercase tracking-wider text-fg-muted">
            Step 1 — Connect GitHub account
          </p>
          {!isConnected ? (
            <div className="flex items-center justify-between rounded-xl border border-ink-700 bg-ink-900 px-4 py-3">
              <p className="text-sm text-fg-secondary">Authorise FlowDesk to access your GitHub repositories.</p>
              <button className="btn-primary !py-1.5 text-xs" onClick={() => void startOAuth()}>
                Connect GitHub
              </button>
            </div>
          ) : (
            <div className="flex items-center gap-3 rounded-xl border border-emerald-800/60 bg-emerald-950/30 px-4 py-3">
              <GitHubIcon size={15} className="shrink-0 text-emerald-400" />
              <span className="flex-1 text-sm text-fg">
                Connected as <span className="font-medium">{oauthStatus.data?.github_user_login}</span>
              </span>
              <button
                className="text-xs text-fg-muted hover:text-red-400"
                onClick={() => disconnectGitHub.mutate()}
                disabled={disconnectGitHub.isPending}
              >
                Disconnect
              </button>
            </div>
          )}
        </section>

        {/* Step 2 — Link a repository */}
        {isConnected && (
          <section>
            <p className="mb-1 text-xs font-semibold uppercase tracking-wider text-fg-muted">
              Step 2 — Link a repository to a project
            </p>

            {/* Already connected repos */}
            {activeRepos.length > 0 && (
              <div className="mb-3 space-y-1">
                {activeRepos.map((repo) => (
                  <div key={repo.id} className="flex items-center gap-2 rounded-lg border border-ink-700 bg-ink-900 px-3 py-2">
                    <GitHubIcon size={13} className="shrink-0 text-fg-secondary" />
                    <span className="min-w-0 flex-1 truncate text-sm text-fg">{repo.repo_full_name}</span>
                    <span className="shrink-0 text-[11px] text-fg-muted">→ {repo.project_name}</span>
                    <button
                      className="text-fg-muted hover:text-red-400"
                      onClick={() => void disconnectRepo(repo.id)}
                      title="Disconnect"
                    >
                      <Trash2 size={13} />
                    </button>
                  </div>
                ))}
              </div>
            )}

            {/* Add a new repo */}
            {repoOptions.length > 0 || availableRepos.isLoading ? (
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
                <select
                  className="input-dark !w-44"
                  value={selectedProject}
                  onChange={(e) => setSelectedProject(e.target.value)}
                >
                  {(projects.data ?? []).map((p) => (
                    <option key={p.id} value={p.id}>{p.name}</option>
                  ))}
                </select>
                <button
                  className="btn-primary !px-4 text-xs"
                  disabled={!selectedRepo || connectRepo.isPending}
                  onClick={() => connectRepo.mutate()}
                >
                  Connect
                </button>
              </div>
            ) : (
              !availableRepos.isLoading && (
                <p className="text-xs text-fg-muted">
                  All accessible repositories are already connected.
                </p>
              )
            )}
          </section>
        )}

      </div>
    </Modal>
  )
}
