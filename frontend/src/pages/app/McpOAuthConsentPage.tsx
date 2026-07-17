import { useMutation, useQuery } from '@tanstack/react-query'
import {
  CheckCircle2,
  ChevronDown,
  Clock3,
  FileText,
  FolderKanban,
  Github,
  Inbox,
  Layout,
  LayoutTemplate,
  Lock,
  MessageSquare,
  ShieldCheck,
  Users,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { useState } from 'react'
import { useSearchParams } from 'react-router-dom'

import { ClaudeIcon, CursorIcon } from '../../components/icons/mcpClients'
import { api, errorMessage } from '../../lib/api'
import { cn } from '../../lib/utils'
import { useAuthStore } from '../../stores/auth'
import { toast } from '../../stores/toast'
import { AuthLogo, AuthMarketingAside, AuthShell } from '../auth/AuthShell'
import { CenteredSpinner } from '../../components/ui/Spinner'

interface AuthRequest {
  request_id: string
  client_name: string
  scopes: string[]
  resource: string | null
}

interface ScopeGroup {
  id: string
  label: string
  icon: LucideIcon
  scopes: string[]
}

const SCOPE_GROUPS: ScopeGroup[] = [
  { id: 'identity', label: 'Identity', icon: ShieldCheck, scopes: ['profile:read', 'mcp:audit'] },
  { id: 'orgs', label: 'Organizations', icon: Users, scopes: ['organizations:read'] },
  { id: 'tasks', label: 'Tasks', icon: CheckCircle2, scopes: ['tasks:read', 'tasks:write'] },
  { id: 'projects', label: 'Projects & search', icon: FolderKanban, scopes: ['projects:read', 'search:read'] },
  { id: 'comments', label: 'Comments', icon: MessageSquare, scopes: ['comments:read', 'comments:write'] },
  { id: 'time', label: 'Time tracking', icon: Clock3, scopes: ['time:read', 'time:write'] },
  { id: 'inbox', label: 'Inbox (not yet PAT-enabled)', icon: Inbox, scopes: ['inbox:read', 'inbox:write'] },
  { id: 'planning', label: 'Sprints (not yet PAT-enabled)', icon: Clock3, scopes: ['sprints:read', 'sprints:write'] },
  { id: 'templates', label: 'Templates (not yet PAT-enabled)', icon: LayoutTemplate, scopes: ['templates:read', 'templates:write'] },
  { id: 'collaboration', label: 'Chat & members (not yet PAT-enabled)', icon: Users, scopes: ['chat:read', 'chat:write', 'members:read'] },
  { id: 'docs', label: 'Documents (not yet PAT-enabled)', icon: FileText, scopes: ['docs:read', 'docs:write'] },
  { id: 'forms', label: 'Forms (not yet PAT-enabled)', icon: Layout, scopes: ['forms:read'] },
  { id: 'whiteboards', label: 'Whiteboards (not yet PAT-enabled)', icon: LayoutTemplate, scopes: ['whiteboards:read'] },
  { id: 'github', label: 'GitHub (not yet PAT-enabled)', icon: Github, scopes: ['github:read', 'github:write'] },
]

const SCOPE_LABELS: Record<string, string> = {
  'profile:read': 'Read your profile',
  'mcp:audit': 'Record MCP tool usage',
  'organizations:read': 'List your organizations',
  'tasks:read': 'View tasks',
  'tasks:write': 'Create & update tasks',
  'projects:read': 'Browse projects',
  'search:read': 'Search workspace',
  'comments:read': 'Read comments',
  'comments:write': 'Comment on tasks',
  'time:read': 'View time entries',
  'time:write': 'Log time',
  'inbox:read': 'Read notifications',
  'inbox:write': 'Manage inbox',
  'sprints:read': 'View sprints',
  'sprints:write': 'Manage sprints',
  'members:read': 'View members',
  'templates:read': 'Browse templates',
  'templates:write': 'Apply templates',
  'chat:read': 'Read chat',
  'chat:write': 'Send messages',
  'docs:read': 'Read documents',
  'docs:write': 'Edit documents',
  'forms:read': 'View forms',
  'whiteboards:read': 'View whiteboards',
  'github:read': 'View GitHub status',
  'github:write': 'Sync GitHub',
}

export default function McpOAuthConsentPage() {
  const [params] = useSearchParams()
  const requestId = params.get('request_id')
  const user = useAuthStore((s) => s.user)

  const authRequest = useQuery({
    queryKey: ['mcp-oauth-request', requestId],
    enabled: !!requestId,
    queryFn: () => api.get<AuthRequest>(`/oauth/mcp/requests/${requestId}`),
  })

  const approve = useMutation({
    mutationFn: () => api.post<{ redirect_to: string }>('/oauth/mcp/approve', { request_id: requestId }),
    onSuccess: (data) => {
      toast.success('Connected — returning to your editor…')
      window.location.href = data.redirect_to
    },
    onError: (err) => toast.error(errorMessage(err)),
  })

  if (!requestId) {
    return (
      <ConsentShell>
        <ConsentState message="This link is missing a connection request. Start again from your MCP client." />
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
        <ConsentState message="This connection request expired or was already used. Open your MCP client settings and connect FlowDesk again." />
      </ConsentShell>
    )
  }

  const req = authRequest.data
  const clientLabel = req.client_name.trim() || 'MCP client'
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
        <ClientAvatar name={clientLabel} />
        <ConnectionDots />
        <div className="flex h-12 w-12 items-center justify-center rounded-2xl border border-slate-200 bg-white shadow-sm">
          <img src="/brightcone icon.png" alt="FlowDesk" className="h-7 w-7" />
        </div>
      </div>

      <h1 className="text-center text-xl font-bold tracking-tight text-slate-900">
        Connect <span className="text-[#0B8FE8]">{clientLabel}</span> to FlowDesk
      </h1>
      <p className="mt-2 text-center text-sm leading-relaxed text-slate-500">
        {clientLabel} is requesting access to act on your behalf in FlowDesk.
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
          Actions follow your FlowDesk role — {clientLabel} can never do more than you can.
        </TrustRow>
        <TrustRow icon={Lock}>
          Your password is never shared. Access uses a scoped token that expires automatically.
        </TrustRow>
        <TrustRow icon={CheckCircle2}>Revoke access anytime in Settings → MCP.</TrustRow>
      </ul>

      <div className="mt-5 flex flex-col gap-2">
        <button
          type="button"
          className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-[#0B172B] px-4 py-2.5 text-sm font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-50"
          disabled={approve.isPending}
          onClick={() => approve.mutate()}
        >
          <ClientButtonIcon name={clientLabel} />
          {approve.isPending ? 'Authorizing…' : 'Allow access'}
        </button>
        <button
          type="button"
          className="w-full rounded-xl border border-slate-200 py-2.5 text-sm font-medium text-slate-600 transition-colors hover:bg-slate-50 hover:text-slate-900"
          onClick={() => {
            window.location.href = '/app/settings?tab=connections'
          }}
        >
          Cancel
        </button>
      </div>
    </ConsentShell>
  )
}

function ConnectionDots() {
  return (
    <div className="flex items-center gap-1" aria-hidden>
      {[0, 1, 2].map((i) => (
        <span key={i} className={cn('h-1 w-1 rounded-full bg-slate-300', i === 1 && 'bg-[#0B8FE8]')} />
      ))}
    </div>
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
          badge="MCP connection"
          title={
            <>
              Your agent,
              <br />
              your workspace.
            </>
          }
          description="Connect Cursor, Claude, or any MCP client to search tasks, update projects, and triage inbox — with the same permissions you have in FlowDesk."
          points={[
            { icon: 'ai', text: 'Search and read across your org' },
            { icon: 'boards', text: 'Create and update work on your behalf' },
            { icon: 'team', text: 'Actions follow your role permissions' },
            { icon: 'api', text: 'Revoke access in one click from Settings' },
          ]}
        />
      }
    >
      {children}
    </AuthShell>
  )
}

function ConsentState({ message }: { message: string }) {
  return (
    <div className="text-center">
      <div className="mx-auto mb-4 flex h-11 w-11 items-center justify-center rounded-full bg-slate-100">
        <Lock size={18} className="text-slate-500" />
      </div>
      <h1 className="text-lg font-semibold text-slate-900">Connection unavailable</h1>
      <p className="mt-2 text-sm leading-relaxed text-slate-500">{message}</p>
      <a
        href="/app/settings?tab=connections"
        className="mt-5 inline-flex rounded-xl bg-[#0B172B] px-5 py-2.5 text-sm font-semibold text-white hover:opacity-90"
      >
        Go to MCP settings
      </a>
    </div>
  )
}

function ScopeSummary({
  grouped,
  ungrouped,
}: {
  grouped: (ScopeGroup & { active: string[] })[]
  ungrouped: string[]
}) {
  const [expanded, setExpanded] = useState(false)
  const totalScopes = grouped.reduce((n, g) => n + g.active.length, 0) + ungrouped.length

  return (
    <div className="mt-4 rounded-xl border border-slate-200 bg-slate-50/90 p-3">
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs font-semibold text-slate-700">
          Can access {grouped.length} {grouped.length === 1 ? 'area' : 'areas'} of your workspace
        </p>
        <button
          type="button"
          className="inline-flex items-center gap-1 text-[11px] font-medium text-[#0B8FE8] hover:underline"
          onClick={() => setExpanded((v) => !v)}
        >
          {expanded ? 'Hide' : `All ${totalScopes} permissions`}
          <ChevronDown size={14} className={cn('transition-transform', expanded && 'rotate-180')} />
        </button>
      </div>

      <div className="mt-3 grid grid-cols-2 gap-2">
        {grouped.map((group) => {
          const Icon = group.icon
          const canWrite = group.active.some((s) => s.endsWith(':write'))
          return (
            <div
              key={group.id}
              className="flex items-center gap-2 rounded-lg border border-white bg-white px-2.5 py-2 shadow-[0_1px_0_rgba(15,23,42,0.04)]"
            >
              <Icon size={13} className="shrink-0 text-[#0B8FE8]" />
              <span className="min-w-0 flex-1 truncate text-[11px] font-medium text-slate-700">{group.label}</span>
              <span
                className={cn(
                  'shrink-0 rounded px-1 py-px text-[9px] font-semibold uppercase tracking-wide',
                  canWrite ? 'bg-amber-50 text-amber-700' : 'bg-slate-100 text-slate-500',
                )}
              >
                {canWrite ? 'Edit' : 'View'}
              </span>
            </div>
          )
        })}
      </div>

      {expanded && (
        <div className="mt-3 max-h-44 space-y-3 overflow-y-auto border-t border-slate-200/80 pt-3">
          {grouped.map((group) => (
            <div key={group.id}>
              <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-slate-400">{group.label}</p>
              <ul className="space-y-1">
                {group.active.map((scope) => (
                  <li key={scope} className="flex items-center justify-between gap-2 text-[11px] text-slate-600">
                    <span>{SCOPE_LABELS[scope] ?? scope}</span>
                    <code className="rounded bg-slate-100 px-1 py-px font-mono text-[9px] text-slate-400">{scope}</code>
                  </li>
                ))}
              </ul>
            </div>
          ))}
          {ungrouped.length > 0 && (
            <ul className="space-y-1">
              {ungrouped.map((scope) => (
                <li key={scope} className="text-[11px] text-slate-600">
                  {SCOPE_LABELS[scope] ?? scope}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  )
}

function ClientAvatar({ name }: { name: string }) {
  const isCursor = /cursor/i.test(name)
  const isClaude = /claude/i.test(name)
  return (
    <div
      className={cn(
        'flex h-12 w-12 items-center justify-center rounded-2xl border shadow-sm',
        isCursor && 'border-slate-200 bg-[#1a1a1a]',
        isClaude && 'border-orange-100 bg-[#FDF6F3]',
        !isCursor && !isClaude && 'border-slate-200 bg-white',
      )}
    >
      {isCursor ? (
        <CursorIcon size={26} />
      ) : isClaude ? (
        <ClaudeIcon size={26} />
      ) : (
        <MessageSquare size={20} className="text-slate-500" />
      )}
    </div>
  )
}

function ClientButtonIcon({ name }: { name: string }) {
  if (/cursor/i.test(name)) return <CursorIcon size={16} />
  if (/claude/i.test(name)) return <ClaudeIcon size={16} />
  return null
}
