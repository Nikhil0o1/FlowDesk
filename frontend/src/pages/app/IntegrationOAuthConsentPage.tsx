import { useMutation, useQuery } from '@tanstack/react-query'
import {
  CheckCircle2,
  ChevronDown,
  Clock3,
  FolderKanban,
  Lock,
  MessageSquare,
  Radio,
  Search,
  ShieldCheck,
  Users,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { useState } from 'react'
import { useSearchParams } from 'react-router-dom'

import { api, errorMessage } from '../../lib/api'
import { cn } from '../../lib/utils'
import { useAuthStore } from '../../stores/auth'
import { toast } from '../../stores/toast'
import { AuthLogo, AuthMarketingAside, AuthShell } from '../auth/AuthShell'
import { CenteredSpinner } from '../../components/ui/Spinner'

interface AuthRequest {
  request_id: string
  client_name: string
  client_id: string
  organization_id: string | null
  scopes: string[]
  redirect_uri: string
}

interface ScopeGroup {
  id: string
  label: string
  icon: LucideIcon
  scopes: string[]
}

const SCOPE_GROUPS: ScopeGroup[] = [
  { id: 'identity', label: 'Identity', icon: ShieldCheck, scopes: ['profile:read'] },
  { id: 'orgs', label: 'Organizations', icon: Users, scopes: ['organizations:read'] },
  { id: 'tasks', label: 'Tasks', icon: CheckCircle2, scopes: ['tasks:read', 'tasks:write'] },
  { id: 'projects', label: 'Projects', icon: FolderKanban, scopes: ['projects:read'] },
  { id: 'search', label: 'Search', icon: Search, scopes: ['search:read'] },
  { id: 'comments', label: 'Comments', icon: MessageSquare, scopes: ['comments:read', 'comments:write'] },
  { id: 'time', label: 'Time tracking', icon: Clock3, scopes: ['time:read', 'time:write'] },
  { id: 'realtime', label: 'Realtime', icon: Radio, scopes: ['realtime:read', 'realtime:write'] },
]

const SCOPE_LABELS: Record<string, string> = {
  'profile:read': 'Read your profile',
  'organizations:read': 'List your organizations',
  'tasks:read': 'View tasks',
  'tasks:write': 'Create & update tasks',
  'projects:read': 'Browse projects',
  'search:read': 'Search workspace',
  'comments:read': 'Read comments',
  'comments:write': 'Comment on tasks',
  'time:read': 'View time entries',
  'time:write': 'Log time',
  'realtime:read': 'Receive realtime updates',
  'realtime:write': 'Send realtime events',
}

export default function IntegrationOAuthConsentPage() {
  const [params] = useSearchParams()
  const requestId = params.get('request_id')
  const user = useAuthStore((s) => s.user)

  const authRequest = useQuery({
    queryKey: ['integration-oauth-request', requestId],
    enabled: !!requestId,
    queryFn: () => api.get<AuthRequest>(`/oauth/integrations/requests/${requestId}`),
  })

  const approve = useMutation({
    mutationFn: () =>
      api.post<{ redirect_to: string }>('/oauth/integrations/approve', {
        request_id: requestId,
      }),
    onSuccess: (data) => {
      toast.success('Connected — returning to the app…')
      window.location.href = data.redirect_to
    },
    onError: (err) => toast.error(errorMessage(err)),
  })

  if (!requestId) {
    return (
      <ConsentShell>
        <ConsentState message="This link is missing a connection request. Start again from your integration’s Connect FlowDesk action." />
      </ConsentShell>
    )
  }

  if (authRequest.isLoading) {
    return (
      <ConsentShell>
        <CenteredSpinner className="py-16" />
      </ConsentShell>
    )
  }

  if (authRequest.isError || !authRequest.data) {
    return (
      <ConsentShell>
        <ConsentState message="This connection request expired or was already used. Start Connect again from your integration." />
      </ConsentShell>
    )
  }

  const req = authRequest.data
  const clientLabel = req.client_name.trim() || 'Integration'
  const scopeSet = new Set(req.scopes)
  const grouped = SCOPE_GROUPS.map((group) => ({
    ...group,
    active: group.scopes.filter((s) => scopeSet.has(s)),
  })).filter((g) => g.active.length > 0)
  const ungrouped = req.scopes.filter((s) => !SCOPE_GROUPS.some((g) => g.scopes.includes(s)))
  const userEmail = user?.email ?? null

  return (
    <ConsentShell>
      <AuthLogo />

      <div className="mb-5 flex items-center justify-center gap-2.5">
        <div className="flex h-12 w-12 items-center justify-center rounded-2xl border border-slate-200 bg-slate-900 text-sm font-bold text-white shadow-sm">
          {clientLabel.slice(0, 1).toUpperCase()}
        </div>
        <div className="flex items-center gap-1" aria-hidden>
          {[0, 1, 2].map((i) => (
            <span
              key={i}
              className={cn('h-1 w-1 rounded-full bg-slate-300', i === 1 && 'bg-[#0B8FE8]')}
            />
          ))}
        </div>
        <div className="flex h-12 w-12 items-center justify-center rounded-2xl border border-slate-200 bg-white shadow-sm">
          <img src="/brightcone icon.png" alt="FlowDesk" className="h-7 w-7" />
        </div>
      </div>

      <h1 className="text-center text-xl font-bold tracking-tight text-slate-900">
        Connect <span className="text-[#0B8FE8]">{clientLabel}</span> to FlowDesk
      </h1>
      <p className="mt-2 text-center text-sm leading-relaxed text-slate-500">
        {clientLabel} is requesting access to act as you in FlowDesk via OAuth (same model as
        ClickUp Custom Apps).
      </p>

      {userEmail && (
        <div className="mt-4 flex items-center justify-center gap-2 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2">
          <span className="flex h-6 w-6 items-center justify-center rounded-full bg-[#0B8FE8]/10 text-[10px] font-bold text-[#0B8FE8]">
            {userEmail.slice(0, 1).toUpperCase()}
          </span>
          <p className="truncate text-xs text-slate-600">
            Authorizing as <span className="font-semibold text-slate-800">{userEmail}</span>
          </p>
        </div>
      )}

      <ScopeSummary grouped={grouped} ungrouped={ungrouped} />

      <ul className="mt-4 space-y-2 rounded-xl border border-slate-200 bg-white px-3.5 py-3">
        <TrustRow icon={ShieldCheck}>
          Actions follow your FlowDesk role — {clientLabel} cannot do more than you can.
        </TrustRow>
        <TrustRow icon={Lock}>
          Your password is never shared. Access uses a user-bound token with peppered storage.
        </TrustRow>
        <TrustRow icon={CheckCircle2}>
          Org admins can revoke the OAuth app in Settings → API Keys.
        </TrustRow>
      </ul>

      <div className="mt-5 flex flex-col gap-2">
        <button
          type="button"
          className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-[#0B172B] px-4 py-2.5 text-sm font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-50"
          disabled={approve.isPending}
          onClick={() => approve.mutate()}
        >
          {approve.isPending ? 'Authorizing…' : 'Allow access'}
        </button>
        <button
          type="button"
          className="w-full rounded-xl border border-slate-200 py-2.5 text-sm font-medium text-slate-600 transition-colors hover:bg-slate-50 hover:text-slate-900"
          onClick={() => {
            window.location.href = '/app/settings?tab=api-keys'
          }}
        >
          Cancel
        </button>
      </div>
    </ConsentShell>
  )
}

function TrustRow({ icon: Icon, children }: { icon: LucideIcon; children: React.ReactNode }) {
  return (
    <li className="flex items-start gap-2 text-[11px] leading-relaxed text-slate-600">
      <Icon size={13} className="mt-0.5 shrink-0 text-emerald-600" />
      <span>{children}</span>
    </li>
  )
}

function ConsentShell({ children }: { children: React.ReactNode }) {
  return (
    <AuthShell
      aside={
        <AuthMarketingAside
          badge="OAuth connection"
          title={
            <>
              Your apps,
              <br />
              your permissions.
            </>
          }
          description="Authorize third-party apps with OAuth. Access tokens are bound to your FlowDesk account and roles."
          points={[
            { icon: 'ai', text: 'Client ID and secret stay on the integrator’s server' },
            { icon: 'boards', text: 'You approve access in FlowDesk' },
            { icon: 'team', text: 'Actions follow your role permissions' },
            { icon: 'api', text: 'Revoke the app anytime from Settings' },
          ]}
        />
      }
    >
      <div className="mx-auto w-full max-w-md px-4 py-8 sm:py-12">{children}</div>
    </AuthShell>
  )
}

function ConsentState({ message }: { message: string }) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-6 text-center shadow-sm">
      <p className="text-sm text-slate-600">{message}</p>
      <a href="/app/settings?tab=api-keys" className="mt-4 inline-block text-sm font-medium text-[#0B8FE8]">
        Open API Keys settings
      </a>
    </div>
  )
}

function ScopeSummary({
  grouped,
  ungrouped,
}: {
  grouped: Array<ScopeGroup & { active: string[] }>
  ungrouped: string[]
}) {
  const [open, setOpen] = useState(true)
  return (
    <div className="mt-4 rounded-xl border border-slate-200 bg-white">
      <button
        type="button"
        className="flex w-full items-center justify-between px-3.5 py-3 text-left"
        onClick={() => setOpen((v) => !v)}
      >
        <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">
          Permissions requested
        </span>
        <ChevronDown size={16} className={cn('text-slate-400 transition', open && 'rotate-180')} />
      </button>
      {open && (
        <div className="space-y-3 border-t border-slate-100 px-3.5 py-3">
          {grouped.map((group) => (
            <div key={group.id}>
              <div className="mb-1 flex items-center gap-1.5 text-xs font-semibold text-slate-700">
                <group.icon size={13} />
                {group.label}
              </div>
              <ul className="ml-5 list-disc space-y-0.5 text-[11px] text-slate-600">
                {group.active.map((s) => (
                  <li key={s}>{SCOPE_LABELS[s] || s}</li>
                ))}
              </ul>
            </div>
          ))}
          {ungrouped.length > 0 && (
            <ul className="list-disc space-y-0.5 pl-5 text-[11px] text-slate-600">
              {ungrouped.map((s) => (
                <li key={s}>{SCOPE_LABELS[s] || s}</li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  )
}
