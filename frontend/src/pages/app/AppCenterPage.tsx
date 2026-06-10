import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Plus, Search, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { useSearchParams } from 'react-router-dom'

import { GitHubIcon, GoogleDriveIcon } from '../../components/icons/brands'

import { api, errorMessage } from '../../lib/api'
import { useCurrentContext, useProjects } from '../../lib/queries'
import { cn, formatDate } from '../../lib/utils'
import { toast } from '../../stores/toast'
import { Modal } from '../../components/ui/Modal'

interface Installation {
  id: string
  installation_id: number
  account_login: string
  account_type: string
  created_at: string
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

const GDRIVE_CONFIGURED = !!import.meta.env.VITE_GOOGLE_CLIENT_ID

export default function AppCenterPage() {
  const [params, setParams] = useSearchParams()
  const app = params.get('app')
  const [q, setQ] = useState('')

  const apps = [
    {
      key: 'github',
      name: 'GitHub',
      icon: <GitHubIcon size={24} className="text-white" />,
      description: 'Link pushes, pull requests and issues to your projects. Reference tasks as KEY-123 in commits.',
      status: 'available' as const,
    },
    {
      key: 'gdrive',
      name: 'Google Drive',
      icon: <GoogleDriveIcon size={24} />,
      description: 'Attach and preview Drive files on tasks.',
      status: (GDRIVE_CONFIGURED ? 'soon' : 'config') as 'soon' | 'config',
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
              <div className="mt-3">
                {appDef.key === 'github' ? (
                  <button
                    className="btn-primary !py-1.5 text-xs"
                    onClick={() => {
                      params.set('app', 'github')
                      setParams(params, { replace: true })
                    }}
                  >
                    Manage connection
                  </button>
                ) : (
                  <span className="inline-flex items-center gap-1.5 rounded-lg bg-ink-750 px-2.5 py-1.5 text-xs text-fg-muted" title="Set GOOGLE_CLIENT_ID in the root .env to enable Google integrations">
                    {GDRIVE_CONFIGURED ? 'Coming soon' : 'Requires Google OAuth configuration'}
                  </span>
                )}
              </div>
            </div>
          </div>
        ))}
        {apps.length === 0 && <p className="col-span-2 py-8 text-center text-sm text-fg-muted">No apps match “{q}”.</p>}
      </div>

      <GitHubPanel open={app === 'github'} onClose={() => { params.delete('app'); setParams(params, { replace: true }) }} />
    </div>
  )
}

function GitHubPanel({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { org, workspace } = useCurrentContext()
  const projects = useProjects(workspace?.id)
  const queryClient = useQueryClient()

  const installations = useQuery({
    queryKey: ['gh-installations', org?.id],
    queryFn: () => api.get<Installation[]>(`/github/organizations/${org!.id}/installations`),
    enabled: open && !!org,
  })

  const projectRepoQueries = useQuery({
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

  const [installationId, setInstallationId] = useState('')
  const [accountLogin, setAccountLogin] = useState('')
  const [repoFullName, setRepoFullName] = useState('')
  const [repoId, setRepoId] = useState('')
  const [repoInstallation, setRepoInstallation] = useState('')
  const [repoProject, setRepoProject] = useState('')

  const registerInstallation = useMutation({
    mutationFn: () =>
      api.post(`/github/organizations/${org!.id}/installations`, {
        installation_id: parseInt(installationId, 10),
        account_login: accountLogin.trim(),
      }),
    onSuccess: () => {
      toast.success('GitHub installation registered')
      setInstallationId('')
      setAccountLogin('')
      void queryClient.invalidateQueries({ queryKey: ['gh-installations'] })
    },
    onError: (err) => toast.error(errorMessage(err)),
  })

  const connectRepo = useMutation({
    mutationFn: () =>
      api.post('/github/repositories', {
        installation_id: repoInstallation || installations.data?.[0]?.id,
        repo_id: parseInt(repoId, 10),
        repo_full_name: repoFullName.trim(),
        project_id: repoProject || projects.data?.[0]?.id,
      }),
    onSuccess: () => {
      toast.success('Repository connected')
      setRepoFullName('')
      setRepoId('')
      void queryClient.invalidateQueries({ queryKey: ['gh-repos'] })
    },
    onError: (err) => toast.error(errorMessage(err)),
  })

  const disconnect = async (repoId: string) => {
    try {
      await api.delete(`/github/repositories/${repoId}`)
      toast.success('Repository disconnected')
      void queryClient.invalidateQueries({ queryKey: ['gh-repos'] })
    } catch (err) {
      toast.error(errorMessage(err))
    }
  }

  const hasInstallation = (installations.data ?? []).length > 0

  return (
    <Modal open={open} onClose={onClose} title="GitHub integration" width="max-w-lg">
      <div className="space-y-5">
        <p className="text-xs leading-relaxed text-fg-muted">
          Point your GitHub App or repository webhook at{' '}
          <code className="rounded bg-ink-800 px-1.5 py-0.5 text-[11px] text-fg-secondary">
            /api/v1/github/webhook
          </code>{' '}
          (events: push, pull_request, issues) and set the same secret in{' '}
          <code className="rounded bg-ink-800 px-1.5 py-0.5 text-[11px] text-fg-secondary">GITHUB_WEBHOOK_SECRET</code>.
        </p>

        {/* Installations */}
        <section>
          <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-fg-muted">Installations</p>
          {(installations.data ?? []).map((inst) => (
            <div key={inst.id} className="mb-1 flex items-center gap-2 rounded-lg border border-ink-700 bg-ink-900 px-3 py-2">
              <GitHubIcon size={13} className="text-fg-secondary" />
              <span className="flex-1 text-sm text-fg">{inst.account_login}</span>
              <span className="text-[11px] text-fg-muted">#{inst.installation_id} · {formatDate(inst.created_at)}</span>
            </div>
          ))}
          {org?.my_role === 'owner' ? (
            <div className="mt-2 flex gap-2">
              <input className="input-dark !w-32" placeholder="Installation ID" value={installationId} onChange={(e) => setInstallationId(e.target.value.replace(/\D/g, ''))} />
              <input className="input-dark flex-1" placeholder="GitHub account/org login" value={accountLogin} onChange={(e) => setAccountLogin(e.target.value)} />
              <button
                className="btn-secondary !px-3 text-xs"
                disabled={!installationId || !accountLogin.trim() || registerInstallation.isPending}
                onClick={() => registerInstallation.mutate()}
              >
                <Plus size={13} />
              </button>
            </div>
          ) : (
            !hasInstallation && <p className="text-xs text-fg-muted">Ask your organization owner to register the GitHub App installation.</p>
          )}
        </section>

        {/* Connected repositories */}
        <section>
          <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-fg-muted">Connected repositories</p>
          {(projectRepoQueries.data ?? []).filter((r) => r.is_active).map((repo) => (
            <div key={repo.id} className="mb-1 flex items-center gap-2 rounded-lg border border-ink-700 bg-ink-900 px-3 py-2">
              <span className="min-w-0 flex-1 truncate text-sm text-fg">{repo.repo_full_name}</span>
              <span className="text-[11px] text-fg-muted">→ {repo.project_name}</span>
              <button className="text-fg-muted hover:text-red-400" onClick={() => disconnect(repo.id)} title="Disconnect">
                <Trash2 size={13} />
              </button>
            </div>
          ))}
          {hasInstallation && (
            <div className={cn('mt-2 space-y-2')}>
              <div className="flex gap-2">
                <input className="input-dark flex-1" placeholder="owner/repo" value={repoFullName} onChange={(e) => setRepoFullName(e.target.value)} />
                <input className="input-dark !w-28" placeholder="Repo ID" value={repoId} onChange={(e) => setRepoId(e.target.value.replace(/\D/g, ''))} />
              </div>
              <div className="flex gap-2">
                <select className="input-dark flex-1" value={repoProject} onChange={(e) => setRepoProject(e.target.value)}>
                  {(projects.data ?? []).map((p) => (
                    <option key={p.id} value={p.id}>
                      → {p.name}
                    </option>
                  ))}
                </select>
                <button
                  className="btn-primary !px-4 text-xs"
                  disabled={!repoFullName.includes('/') || !repoId || connectRepo.isPending}
                  onClick={() => connectRepo.mutate()}
                >
                  Connect
                </button>
              </div>
              <p className="text-[11px] text-fg-muted">
                Repo ID is on the repository's API page: api.github.com/repos/owner/repo → "id".
              </p>
            </div>
          )}
        </section>
      </div>
    </Modal>
  )
}
