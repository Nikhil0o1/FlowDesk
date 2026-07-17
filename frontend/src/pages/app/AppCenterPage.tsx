import { useMutation, useQueries, useQuery, useQueryClient } from '@tanstack/react-query'
import { CheckCircle2, Search, Trash2 } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'

import {
  GitHubIcon,
  GmailIcon,
  GoogleCalendarIcon,
  GoogleSheetsIcon,
} from '../../components/icons/brands'

import { api, errorMessage } from '../../lib/api'
import { startGithubOAuth } from '../../lib/githubOAuth'
import { EXTERNAL_LINK_REL, safeHttpUrl } from '../../lib/safeUrl'
import { useCurrentContext, useProjects } from '../../lib/queries'
import { cn } from '../../lib/utils'
import { useAuthStore } from '../../stores/auth'
import { toast } from '../../stores/toast'
import { Modal } from '../../components/ui/Modal'

interface ConnectionStatus {
  connected: boolean
  github_user_login: string | null
  needs_reconnect?: boolean
  connection_type?: 'personal' | 'workspace' | null
  can_manage?: boolean
  can_connect?: boolean
  can_disconnect?: boolean
  can_link_repo?: boolean
  connected_by?: string | null
  branch_name_format?: string | null
  connected_search_enabled?: boolean | null
}

interface AvailableRepo {
  repo_id: number
  repo_full_name: string
  default_branch: string
  private: boolean
}

interface PersonalLink {
  id: string
  repo_full_name: string
  project_id: string
  project_name: string
  connected_by: string | null
}

interface Repository {
  id: string
  installation_id: string | null
  connection_id: string | null
  project_id: string | null
  workspace_id: string | null
  repo_id: number
  repo_full_name: string
  is_active: boolean
  connected_by: string | null
  created_at: string
}

function canAdminProject(
  project: { my_role: string | null } | undefined,
  workspace: { my_role: string | null } | null | undefined,
  org: { my_role: string | null } | null | undefined,
): boolean {
  if (!project) return false
  return (
    project.my_role === 'admin' ||
    workspace?.my_role === 'admin' ||
    workspace?.my_role === 'owner' ||
    org?.my_role === 'owner' ||
    org?.my_role === 'admin'
  )
}

interface GoogleStatus {
  configured: boolean
  connected: boolean
  account_email: string | null
  scopes: { calendar: boolean; gmail_send: boolean; gmail_read: boolean; sheets: boolean }
}

type GoogleTool = 'calendar' | 'gmail' | 'sheets'

const GOOGLE_TOOL_LABELS: Record<GoogleTool, string> = {
  calendar: 'Google Calendar',
  gmail: 'Gmail',
  sheets: 'Google Sheets',
}

function matchesSearch(name: string, query: string): boolean {
  return !query.trim() || name.toLowerCase().includes(query.trim().toLowerCase())
}

function allGoogleToolsConnected(scopes: GoogleStatus['scopes'] | undefined): boolean {
  if (!scopes) return false
  return scopes.calendar && scopes.gmail_send && scopes.gmail_read && scopes.sheets
}

export default function AppCenterPage() {
  const [params, setParams] = useSearchParams()
  const queryClient = useQueryClient()
  const app = params.get('app')
  const [q, setQ] = useState(params.get('q') ?? '')

  // OAuth redirect — per-tool, bulk (partial OK), or error toasts
  useEffect(() => {
    const connected = params.get('connected')
    const tool = params.get('tool')
    const toolsParam = params.get('tools')
    if (connected === 'google' && toolsParam) {
      const tools = toolsParam
        .split(',')
        .filter((t): t is GoogleTool => t in GOOGLE_TOOL_LABELS)
      if (tools.length > 0) {
        const names = tools.map((t) => GOOGLE_TOOL_LABELS[t]).join(', ')
        toast.success(
          tools.length === 1
            ? `${names} is connected successfully`
            : `${names} are connected successfully`,
        )
      }
      void queryClient.invalidateQueries({ queryKey: ['google-status'] })
      void queryClient.invalidateQueries({ queryKey: ['calendar-status'] })
      params.delete('connected')
      params.delete('tools')
      params.delete('tool')
      setParams(params, { replace: true })
    } else if (connected === 'google' && tool && tool in GOOGLE_TOOL_LABELS) {
      toast.success(`${GOOGLE_TOOL_LABELS[tool as GoogleTool]} is connected successfully`)
      void queryClient.invalidateQueries({ queryKey: ['google-status'] })
      void queryClient.invalidateQueries({ queryKey: ['calendar-status'] })
      params.delete('connected')
      params.delete('tool')
      setParams(params, { replace: true })
    }
    if (params.get('calendar_error') === 'partial') {
      toast.error(
        'Google did not grant enough permissions for that tool. Approve Calendar, Gmail, or Sheets access and try again.',
      )
      params.delete('calendar_error')
      setParams(params, { replace: true })
    } else if (params.get('calendar_error') === '1') {
      toast.error('Google connection failed — try again')
      params.delete('calendar_error')
      setParams(params, { replace: true })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
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

  const googleTools = [
    {
      key: 'gcal',
      tool: 'calendar' as const,
      name: GOOGLE_TOOL_LABELS.calendar,
      icon: <GoogleCalendarIcon size={20} />,
      description: 'Planner meetings beside task deadlines',
      connected: !!s?.calendar,
    },
    {
      key: 'gmail',
      tool: 'gmail' as const,
      name: GOOGLE_TOOL_LABELS.gmail,
      icon: <GmailIcon size={20} />,
      description: 'Send invites and see task-related email',
      connected: !!s?.gmail_send && !!s?.gmail_read,
    },
    {
      key: 'gsheets',
      tool: 'sheets' as const,
      name: GOOGLE_TOOL_LABELS.sheets,
      icon: <GoogleSheetsIcon size={20} />,
      description: 'Two-way spreadsheet sync for projects',
      connected: !!s?.sheets,
    },
  ].filter((t) => matchesSearch(t.name, q))

  const showGithub = matchesSearch('GitHub', q)
  const showGoogle = matchesSearch('Google', q) || googleTools.length > 0
  const nothingVisible = !showGithub && !showGoogle
  const googleAllConnected = allGoogleToolsConnected(s)

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

      <div className="mt-7 grid grid-cols-1 gap-4 md:grid-cols-2">
        {showGithub && (
          <section className="rounded-2xl border border-ink-700 bg-ink-850/60 p-5">
            <div className="flex items-start gap-3">
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-ink-800">
                <GitHubIcon size={22} className="text-fg" />
              </span>
              <div className="min-w-0 flex-1">
                <h2 className="text-sm font-semibold text-fg">GitHub</h2>
                <p className="mt-0.5 text-xs leading-relaxed text-fg-secondary">
                  Bring your code activity into the project it belongs to.
                </p>
              </div>
            </div>
            <ul className="mt-3 space-y-1">
              {[
                'Pushes, PRs and issues stream into the project feed',
                'PHX-12 in a commit or PR moves the task to that status',
                'Open a branch or GitHub issue from any task',
              ].map((b) => (
                <li key={b} className="flex items-start gap-1.5 text-[11px] leading-relaxed text-fg-muted">
                  <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-brand" />
                  {b}
                </li>
              ))}
            </ul>
            <div className="mt-4">
              <button
                className="btn-primary !py-1.5 text-xs"
                onClick={() => {
                  params.set('app', 'github')
                  setParams(params, { replace: true })
                }}
              >
                Connect
              </button>
            </div>
          </section>
        )}

        {showGoogle && (
          <section className="rounded-2xl border border-ink-700 bg-ink-850/60 p-5">
            <div className="mb-4 flex items-start justify-between gap-3">
              <div className="min-w-0 flex-1">
                <h2 className="text-sm font-semibold text-fg">Google tools</h2>
                <p className="mt-0.5 text-xs text-fg-secondary">
                  Connect each tool separately — only the scopes you approve are used.
                </p>
                {googleStatus.data?.account_email && (s?.calendar || (s?.gmail_send && s?.gmail_read) || s?.sheets) && (
                  <p className="mt-2 flex items-center gap-1.5 text-xs text-emerald-400">
                    <CheckCircle2 size={13} />
                    Signed in as {googleStatus.data.account_email}
                  </p>
                )}
              </div>
              {googleAllConnected && (
                <span
                  className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-emerald-500/30 bg-emerald-500/10 text-emerald-400"
                  title="All Google tools connected"
                >
                  <CheckCircle2 size={20} strokeWidth={2.25} />
                </span>
              )}
            </div>
            <div className="divide-y divide-ink-700/80 rounded-xl border border-ink-700 bg-ink-900/40">
              {googleTools.map((toolDef) => (
                <GoogleToolRow
                  key={toolDef.key}
                  tool={toolDef.tool}
                  toolName={toolDef.name}
                  icon={toolDef.icon}
                  description={toolDef.description}
                  status={googleStatus.data}
                  connected={toolDef.connected}
                />
              ))}
            </div>
          </section>
        )}
      </div>

      {nothingVisible && (
        <p className="py-12 text-center text-sm text-fg-muted">No apps match “{q}”.</p>
      )}

      <GitHubPanel
        open={app === 'github'}
        initialTab={params.get('gh_tab') === 'project' ? 'project' : 'personal'}
        onClose={() => { params.delete('app'); params.delete('gh_tab'); setParams(params, { replace: true }) }}
      />
    </div>
  )
}

/** Per-tool connect/disconnect row inside the Google tools card. */
function GoogleToolRow({
  tool,
  toolName,
  icon,
  description,
  status,
  connected,
}: {
  tool: GoogleTool
  toolName: string
  icon: React.ReactNode
  description: string
  status: GoogleStatus | undefined
  connected: boolean
}) {
  const queryClient = useQueryClient()
  const [busy, setBusy] = useState(false)

  const connect = async () => {
    setBusy(true)
    try {
      const { url } = await api.get<{ url: string }>(
        `/calendar/google/auth-url?next=apps&tool=${tool}`,
      )
      window.location.href = url
    } catch (err) {
      toast.error(errorMessage(err))
      setBusy(false)
    }
  }

  const disconnect = async () => {
    setBusy(true)
    try {
      await api.delete(`/calendar/google?tool=${tool}`)
      toast.success(`${toolName} disconnected`)
      void queryClient.invalidateQueries({ queryKey: ['google-status'] })
      void queryClient.invalidateQueries({ queryKey: ['calendar-status'] })
    } catch (err) {
      toast.error(errorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  if (!status) {
    return (
      <div className="flex items-center gap-3 px-3 py-3">
        <span className="h-8 w-8 shrink-0 rounded-lg bg-ink-800" />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium text-fg">{toolName}</p>
          <p className="text-[11px] text-fg-muted">{description}</p>
        </div>
      </div>
    )
  }

  if (!status.configured) {
    return (
      <div className="flex items-center gap-3 px-3 py-3">
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-ink-800">{icon}</span>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium text-fg">{toolName}</p>
          <p className="text-[11px] text-fg-muted">Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET in the root .env</p>
        </div>
      </div>
    )
  }

  return (
    <div className="flex items-center gap-3 px-3 py-3">
      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-ink-800">{icon}</span>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium text-fg">{toolName}</p>
        <p className="text-[11px] text-fg-muted">{description}</p>
        {connected && (
          <p className="mt-0.5 flex items-center gap-1 text-[11px] text-emerald-400">
            <CheckCircle2 size={11} />
            Connected
          </p>
        )}
      </div>
      <div className="flex shrink-0 items-center gap-1.5">
        <button
          type="button"
          className={cn('btn-primary !px-2.5 !py-1 text-xs', (connected || busy) && 'pointer-events-none opacity-40')}
          disabled={connected || busy}
          title={`Connect ${toolName}`}
          onClick={() => void connect()}
        >
          Connect
        </button>
        <button
          type="button"
          className={cn(
            'text-xs text-fg-muted transition-colors hover:text-red-400',
            (!connected || busy) && 'pointer-events-none opacity-40',
          )}
          disabled={!connected || busy}
          title={`Disconnect ${toolName}`}
          onClick={() => void disconnect()}
        >
          Disconnect
        </button>
      </div>
    </div>
  )
}

function GitHubPanel({ open, onClose, initialTab }: { open: boolean; onClose: () => void; initialTab: 'personal' | 'project' }) {
  const { org, workspace } = useCurrentContext()
  const projects = useProjects(workspace?.id)
  const queryClient = useQueryClient()
  const userId = useAuthStore((s) => s.user?.id)
  const [tab, setTab] = useState<'personal' | 'project'>(initialTab)
  useEffect(() => { if (open) setTab(initialTab) }, [open, initialTab])

  const syncGithubQueries = useCallback(async () => {
    await Promise.all([
      queryClient.refetchQueries({ queryKey: ['gh-proj-repos'] }),
      queryClient.refetchQueries({ queryKey: ['gh-proj-conn'] }),
      queryClient.refetchQueries({ queryKey: ['gh-personal-links'] }),
      queryClient.refetchQueries({ queryKey: ['gh-available-repos'] }),
      queryClient.refetchQueries({ queryKey: ['project-repos'] }),
      queryClient.refetchQueries({ queryKey: ['github-events'] }),
    ])
  }, [queryClient])

  useEffect(() => {
    if (!open || !org) return
    void syncGithubQueries()
  }, [open, org?.id, syncGithubQueries])

  useEffect(() => {
    if (!open) return
    void syncGithubQueries()
  }, [tab, open, syncGithubQueries])

  // Personal connection (per org+user)
  const personal = useQuery({
    queryKey: ['gh-personal', org?.id, userId],
    queryFn: () => api.get<ConnectionStatus>(`/github/organizations/${org!.id}/personal-connection`),
    enabled: open && !!org,
  })

  // Repos the caller's own GitHub account can access (for visibility + task actions)
  const personalRepos = useQuery({
    queryKey: ['gh-personal-repos', org?.id, userId],
    queryFn: () => api.get<AvailableRepo[]>(`/github/organizations/${org!.id}/personal-connection/repos`),
    enabled: open && !!org && personal.data?.connected === true,
  })

  // Which of those repos are linked to a project (via this personal connection)
  const personalLinks = useQuery({
    queryKey: ['gh-personal-links', org?.id, userId],
    queryFn: () => api.get<PersonalLink[]>(`/github/organizations/${org!.id}/personal-connection/links`),
    enabled: open && !!org && personal.data?.connected === true,
    staleTime: 0,
    refetchOnMount: 'always',
  })
  const linkByRepo = new Map((personalLinks.data ?? []).map((l) => [l.repo_full_name, l]))

  const linkPersonalRepo = useMutation({
    mutationFn: (vars: { repo_full_name: string; project_id: string }) =>
      api.post(`/github/organizations/${org!.id}/personal-connection/connect-repo`, vars),
    onSuccess: () => {
      toast.success('Repository linked — activity will sync into that project')
      void syncGithubQueries()
    },
    onError: (err) => toast.error(errorMessage(err)),
  })

  const unlinkPersonalRepo = useMutation({
    mutationFn: (repoId: string) => api.delete(`/github/repositories/${repoId}`),
    onSuccess: () => {
      toast.success('Repository unlinked')
      void syncGithubQueries()
    },
    onError: (err) => toast.error(errorMessage(err)),
  })

  // Which project's shared connection we're managing
  const [connProjectId, setConnProjectId] = useState('')
  const pid = connProjectId || projects.data?.[0]?.id || ''
  const currentProject = (projects.data ?? []).find((p) => p.id === pid)

  // Project connection (shared by the project's members; the lead's account)
  const projConn = useQuery({
    queryKey: ['gh-proj-conn', pid],
    queryFn: () => api.get<ConnectionStatus>(`/github/projects/${pid}/connection`),
    enabled: open && !!pid,
    staleTime: 0,
    refetchOnMount: 'always',
  })
  const canManage = projConn.data?.can_manage === true
  const canConnectProject = projConn.data?.can_connect === true
  const canDisconnectProject = projConn.data?.can_disconnect === true
  const canLinkRepo = projConn.data?.can_link_repo === true
  const projConnected = projConn.data?.connected === true

  // Repos the project connection can see — only for the connector when no repo is linked yet
  const availableRepos = useQuery({
    queryKey: ['gh-available-repos', pid],
    queryFn: () => api.get<AvailableRepo[]>(`/github/projects/${pid}/available-repos`),
    enabled: open && !!pid && canLinkRepo && projConnected,
  })

  const projectRepos = useQuery({
    queryKey: ['gh-proj-repos', pid],
    queryFn: () => api.get<Repository[]>(`/github/projects/${pid}/repositories`),
    enabled: open && !!pid,
    staleTime: 0,
    refetchOnMount: 'always',
  })

  const [selectedRepo, setSelectedRepo] = useState('')

  const startOAuth = (type: 'personal' | 'project') => {
    if (type === 'project') {
      void startGithubOAuth({ type: 'project', projectId: pid })
    } else {
      void startGithubOAuth({ type: 'personal', orgId: org!.id })
    }
  }

  const disconnectPersonal = useMutation({
    mutationFn: () => api.delete(`/github/organizations/${org!.id}/personal-connection`),
    onSuccess: () => { toast.success('Personal GitHub disconnected'); void queryClient.invalidateQueries({ queryKey: ['gh-personal'] }) },
    onError: (err) => toast.error(errorMessage(err)),
  })

  const disconnectProject = useMutation({
    mutationFn: () => api.delete(`/github/projects/${pid}/connection`),
    onSuccess: () => {
      toast.success('Project GitHub disconnected')
      void syncGithubQueries()
    },
    onError: (err) => toast.error(errorMessage(err)),
  })

  const connectRepo = useMutation({
    mutationFn: () => api.post(`/github/projects/${pid}/connect-repo`, { repo_full_name: selectedRepo }),
    onSuccess: () => {
      toast.success('Repository linked')
      setSelectedRepo('')
      void syncGithubQueries()
    },
    onError: (err) => toast.error(errorMessage(err)),
  })

  const disconnectRepo = async (repoId: string) => {
    try {
      await api.delete(`/github/repositories/${repoId}`)
      toast.success('Repository unlinked')
      await syncGithubQueries()
    } catch (err) { toast.error(errorMessage(err)) }
  }

  const activeRepos = (projectRepos.data ?? []).filter((r) => r.is_active)
  const linkedRepo = activeRepos[0] ?? null
  const hasLinkedRepo = activeRepos.length > 0
  const projectConnectorId = projConn.data?.connected_by ?? null
  const canUnlinkRepo = (connectedBy: string | null | undefined) => {
    if (!userId) return false
    const linker = connectedBy ?? projectConnectorId
    return !!linker && String(linker) === String(userId)
  }
  const alreadyConnected = new Set(activeRepos.map((r) => r.repo_full_name))

  const projectRepoQueries = useQueries({
    queries: (projects.data ?? []).map((p) => ({
      queryKey: ['gh-proj-repos', p.id],
      queryFn: () => api.get<Repository[]>(`/github/projects/${p.id}/repositories`),
      enabled: open && !!p.id,
      staleTime: 0,
      refetchOnMount: 'always' as const,
    })),
  })
  const projectConnQueries = useQueries({
    queries: (projects.data ?? []).map((p) => ({
      queryKey: ['gh-proj-conn', p.id],
      queryFn: () => api.get<ConnectionStatus>(`/github/projects/${p.id}/connection`),
      enabled: open && !!p.id,
      staleTime: 0,
      refetchOnMount: 'always' as const,
    })),
  })
  const projectsWithLinkedRepo = new Set(
    (projects.data ?? []).filter((p, i) => ((projectRepoQueries[i]?.data as Repository[] | undefined)?.length ?? 0) > 0).map((p) => p.id),
  )
  const projectsWithProjectConnection = new Set<string>()
  ;(projects.data ?? []).forEach((p, i) => {
    if (projectConnQueries[i]?.data?.connected === true) projectsWithProjectConnection.add(p.id)
  })
  const projectLinkByRepo = new Map<string, { projectName: string; repoId: string; connectedBy: string | null }>()
  ;(projects.data ?? []).forEach((p, i) => {
    for (const repo of (projectRepoQueries[i]?.data as Repository[] | undefined) ?? []) {
      if (repo.is_active) {
        projectLinkByRepo.set(repo.repo_full_name, {
          projectName: p.name,
          repoId: repo.id,
          connectedBy: repo.connected_by,
        })
      }
    }
  })
  const repoOptions = (Array.isArray(availableRepos.data) ? availableRepos.data : []).filter((r) => {
    if (alreadyConnected.has(r.repo_full_name)) return false
    const otherProjectLink = projectLinkByRepo.get(r.repo_full_name)
    if (otherProjectLink && linkedRepo?.repo_full_name !== r.repo_full_name) return false
    return true
  })
  const personalLinkableProjects = (projects.data ?? []).filter(
    (p) =>
      !projectsWithLinkedRepo.has(p.id) &&
      !projectsWithProjectConnection.has(p.id) &&
      canAdminProject(p, workspace, org),
  )
  const canLinkPersonalToProject = personalLinkableProjects.length > 0

  const personalConnected = personal.data?.connected === true
  const noProjects = (projects.data ?? []).length === 0

  return (
    <Modal open={open} onClose={onClose} title="GitHub" width="max-w-lg">
      {/* Tabs — your account vs a project's shared connection */}
      <div className="mb-4 flex gap-1 border-b border-ink-700">
        {(['personal', 'project'] as const).map((t) => (
          <button
            key={t}
            className={`-mb-px border-b-2 px-3 py-2 text-sm font-medium ${
              tab === t ? 'border-fg text-fg' : 'border-transparent text-fg-muted hover:text-fg-secondary'
            }`}
            onClick={() => setTab(t)}
          >
            {t === 'personal' ? 'Personal' : 'Project'}
          </button>
        ))}
      </div>

      {tab === 'personal' ? (
        <div className="space-y-5">
          {!personalConnected ? (
            <div className="flex items-center justify-between rounded-xl border border-ink-700 bg-ink-900 px-4 py-3">
              <div>
                <p className="text-sm font-medium text-fg">
                  {personal.data?.needs_reconnect ? 'Reconnect your personal GitHub' : 'Create a personal connection'}
                </p>
                <p className="text-xs text-fg-muted">
                  {personal.data?.needs_reconnect
                    ? 'Your GitHub token expired or was revoked. Reconnect to restore branch and issue actions.'
                    : 'A connection only for you — task actions run as your GitHub account.'}
                </p>
              </div>
              <button className="btn-primary !py-1.5 text-xs" onClick={() => startOAuth('personal')}>
                {personal.data?.needs_reconnect ? 'Reconnect' : 'Connect'}
              </button>
            </div>
          ) : (
            <div className="flex items-center gap-3 rounded-xl border border-emerald-800/60 bg-emerald-950/30 px-4 py-3">
              <GitHubIcon size={15} className="shrink-0 text-emerald-400" />
              <span className="flex-1 text-sm text-fg">Connected as <span className="font-medium">{personal.data?.github_user_login}</span></span>
              <button className="text-xs text-fg-muted hover:text-red-400" onClick={() => disconnectPersonal.mutate()} disabled={disconnectPersonal.isPending}>Disconnect</button>
            </div>
          )}
          {personalConnected && (
            <div>
              <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-fg-muted">Your repositories</p>
              {personalRepos.isLoading ? (
                <p className="text-xs text-fg-muted">Loading your repositories…</p>
              ) : (personalRepos.data ?? []).length === 0 ? (
                <p className="text-xs text-fg-muted">
                  {personalRepos.isError
                    ? 'Could not load your repositories from GitHub.'
                    : 'No repositories found for your GitHub account.'}
                </p>
              ) : (
                <>
                  <div className="max-h-60 space-y-1 overflow-y-auto pr-1">
                    {(personalRepos.data ?? []).map((r) => {
                      const personalLink = linkByRepo.get(r.repo_full_name)
                      const projectLink = projectLinkByRepo.get(r.repo_full_name)
                      return (
                        <div
                          key={r.repo_id}
                          className="flex items-center gap-2 rounded-lg border border-ink-700 bg-ink-900 px-3 py-2"
                        >
                          <GitHubIcon size={13} className="shrink-0 text-fg-secondary" />
                          <a
                            href={safeHttpUrl(`https://github.com/${r.repo_full_name}`) ?? undefined}
                            target="_blank"
                            rel={EXTERNAL_LINK_REL}
                            className="min-w-0 flex-1 truncate text-sm text-fg hover:underline"
                            title={`Open ${r.repo_full_name} on GitHub`}
                          >
                            {r.private ? '🔒 ' : ''}{r.repo_full_name}
                          </a>
                          {personalLink ? (
                            <span className="flex shrink-0 items-center gap-2">
                              <span className="max-w-[120px] truncate text-[11px] text-emerald-400" title={`Synced to ${personalLink.project_name}`}>
                                → {personalLink.project_name}
                              </span>
                              {canUnlinkRepo(personalLink.connected_by) && (
                                <button
                                  className="text-fg-muted hover:text-red-400"
                                  title="Unlink"
                                  disabled={unlinkPersonalRepo.isPending}
                                  onClick={() => unlinkPersonalRepo.mutate(personalLink.id)}
                                >
                                  <Trash2 size={13} />
                                </button>
                              )}
                            </span>
                          ) : projectLink ? (
                            <span className="flex shrink-0 items-center gap-2">
                              <span
                                className="max-w-[120px] truncate text-[11px] text-emerald-400"
                                title={`Linked via Project tab to ${projectLink.projectName}`}
                              >
                                → {projectLink.projectName}
                              </span>
                              {canUnlinkRepo(projectLink.connectedBy) && (
                                <button
                                  className="text-fg-muted hover:text-red-400"
                                  title="Unlink"
                                  disabled={unlinkPersonalRepo.isPending}
                                  onClick={() => unlinkPersonalRepo.mutate(projectLink.repoId)}
                                >
                                  <Trash2 size={13} />
                                </button>
                              )}
                            </span>
                          ) : canLinkPersonalToProject ? (
                            <select
                              className="input-dark shrink-0 !w-auto !py-1 text-xs"
                              value=""
                              disabled={linkPersonalRepo.isPending}
                              onChange={(e) => {
                                if (e.target.value) {
                                  linkPersonalRepo.mutate({ repo_full_name: r.repo_full_name, project_id: e.target.value })
                                }
                              }}
                            >
                              <option value="">Link to…</option>
                              {personalLinkableProjects.map((p) => (
                                <option key={p.id} value={p.id}>{p.name}</option>
                              ))}
                            </select>
                          ) : null}
                        </div>
                      )
                    })}
                  </div>
                  <p className="mt-2 text-xs text-fg-muted">
                    {canLinkPersonalToProject ? (
                      <>
                        <span className="text-fg-secondary">Link</span> a repo to a project to sync its pushes and
                        issues into that project's tasks. Or open any task's <span className="text-fg-secondary">Development</span> panel
                        to create a branch or issue on one of these — as you.
                      </>
                    ) : (
                      <>
                        Repos linked on the <span className="text-fg-secondary">Project</span> tab appear here for visibility.
                        Open any task's <span className="text-fg-secondary">Development</span> panel to create a branch or issue — as you.
                      </>
                    )}
                  </p>
                </>
              )}
            </div>
          )}
          <div>
            <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-fg-muted">What this powers</p>
            <ul className="space-y-1.5 text-sm text-fg-secondary">
              <li>• Create a GitHub issue or branch from any task — as you</li>
              <li>• Link any of your repos to a project — its pushes and issues then sync into that project's tasks</li>
              <li>• Use any repository your own GitHub account can access — no separate project connection needed</li>
              <li>• You only ever see what your own GitHub account can access</li>
            </ul>
          </div>
        </div>
      ) : (
        <div className="space-y-5">
          {noProjects ? (
            <p className="py-6 text-center text-sm text-fg-muted">No projects in this workspace yet.</p>
          ) : (
            <>
              {/* Project selector */}
              <div>
                <label className="mb-1 block text-xs text-fg-secondary">Project</label>
                <select className="input-dark w-full" value={pid} onChange={(e) => setConnProjectId(e.target.value)}>
                  {(projects.data ?? []).map((p) => (<option key={p.id} value={p.id}>{p.name}</option>))}
                </select>
              </div>

              {/* Shared connection — the project lead's account */}
              {!projConnected ? (
                <div className="flex items-center justify-between rounded-xl border border-ink-700 bg-ink-900 px-4 py-3">
                  <div>
                    <p className="text-sm font-medium text-fg">
                      {projConn.data?.needs_reconnect
                        ? `Reconnect GitHub for ${currentProject?.name ?? 'this project'}`
                        : `GitHub not connected for ${currentProject?.name ?? 'this project'}`}
                    </p>
                    <p className="text-xs text-fg-muted">
                      {projConn.data?.needs_reconnect
                        ? 'The project GitHub token expired or was revoked. Reconnect to restore repo sync and task actions.'
                        : 'A shared connection for everyone on this project — powers activity sync and repo links.'}
                    </p>
                  </div>
                  {canConnectProject ? (
                    <button className="btn-primary !py-1.5 text-xs" onClick={() => startOAuth('project')}>
                      {projConn.data?.needs_reconnect ? 'Reconnect' : 'Connect'}
                    </button>
                  ) : (
                    <span className="shrink-0 text-xs text-fg-muted">Ask a project admin</span>
                  )}
                </div>
              ) : (
                <div className="flex items-center gap-3 rounded-xl border border-emerald-800/60 bg-emerald-950/30 px-4 py-3">
                  <GitHubIcon size={15} className="shrink-0 text-emerald-400" />
                  <span className="flex-1 text-sm text-fg">Connected as <span className="font-medium">{projConn.data?.github_user_login}</span></span>
                  {canDisconnectProject && (
                    <button className="text-xs text-fg-muted hover:text-red-400" onClick={() => disconnectProject.mutate()} disabled={disconnectProject.isPending}>Disconnect</button>
                  )}
                </div>
              )}

              {/* Linked repository — visible to all project members */}
              <section>
                <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-fg-muted">Linked repository</p>
                {!projConnected ? (
                  <p className="text-xs text-fg-muted">No repository — GitHub is not connected for this project yet.</p>
                ) : linkedRepo ? (
                  <div className="flex items-center gap-2 rounded-lg border border-ink-700 bg-ink-900 px-3 py-2">
                    <GitHubIcon size={13} className="shrink-0 text-fg-secondary" />
                    <span className="min-w-0 flex-1 truncate text-sm text-fg">{linkedRepo.repo_full_name}</span>
                    {canUnlinkRepo(linkedRepo.connected_by) && (
                      <button
                        className="text-fg-muted hover:text-red-400"
                        onClick={() => void disconnectRepo(linkedRepo.id)}
                        title="Unlink repository"
                      >
                        <Trash2 size={13} />
                      </button>
                    )}
                  </div>
                ) : canLinkRepo ? (
                  repoOptions.length > 0 || availableRepos.isLoading ? (
                    <div className="flex gap-2">
                      <select
                        className="input-dark flex-1"
                        value={selectedRepo}
                        onChange={(e) => setSelectedRepo(e.target.value)}
                        disabled={availableRepos.isLoading}
                      >
                        <option value="">{availableRepos.isLoading ? 'Loading repositories…' : 'Select a repository'}</option>
                        {repoOptions.map((r) => (<option key={r.repo_id} value={r.repo_full_name}>{r.private ? '🔒 ' : ''}{r.repo_full_name}</option>))}
                      </select>
                      <button className="btn-primary !px-4 text-xs" disabled={!selectedRepo || connectRepo.isPending} onClick={() => connectRepo.mutate()}>Link</button>
                    </div>
                  ) : (
                    <p className="text-xs text-fg-muted">No accessible repositories found on this GitHub connection.</p>
                  )
                ) : (
                  <p className="text-xs text-fg-muted">
                    {canManage && !canLinkRepo
                      ? 'Only the project admin who connected GitHub can link a repository.'
                      : 'No repository linked for this project.'}
                  </p>
                )}
                {projConnected && linkedRepo && activeRepos.length > 1 && (
                  <p className="mt-2 text-xs text-amber-400">
                    This project has multiple linked repositories from before the one-repo limit. Only the linker can remove each one.
                  </p>
                )}
                {projConnected && linkedRepo && activeRepos.length > 1 && (
                  <div className="mt-2 space-y-1">
                    {activeRepos.slice(1).map((repo) => (
                      <div key={repo.id} className="flex items-center gap-2 rounded-lg border border-ink-700/60 bg-ink-900/60 px-3 py-2">
                        <span className="min-w-0 flex-1 truncate text-xs text-fg-muted">{repo.repo_full_name}</span>
                        {canUnlinkRepo(repo.connected_by) && (
                          <button className="text-fg-muted hover:text-red-400" onClick={() => void disconnectRepo(repo.id)} title="Unlink">
                            <Trash2 size={12} />
                          </button>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </section>

              <div>
                <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-fg-muted">What this powers</p>
                <ul className="space-y-1.5 text-sm text-fg-secondary">
                  <li>• Everyone on this project shares the lead's GitHub connection</li>
                  <li>• Pushes and issues stream into the project feed and linked tasks</li>
                  <li>• Issue closed on GitHub → task moves to Complete; use Reopen on the task to undo</li>
                </ul>
              </div>
            </>
          )}
        </div>
      )}
    </Modal>
  )
}
