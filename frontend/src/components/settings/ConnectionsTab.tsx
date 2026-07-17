import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  AlertTriangle,
  Check,
  ChevronDown,
  Copy,
  ExternalLink,
  Globe,
  HelpCircle,
  History,
  Link2,
  MonitorSmartphone,
  ShieldCheck,
  SquareTerminal,
  Terminal,
  Trash2,
  Wrench,
} from 'lucide-react'
import { useState } from 'react'

import { ClaudeIcon, CursorIcon } from '../icons/mcpClients'
import { api, errorMessage } from '../../lib/api'
import { isLoopbackUrl, type McpConnectInfo, resolveMcpConnectInfo } from '../../lib/mcpConnect'
import { cn } from '../../lib/utils'
import { toast } from '../../stores/toast'
import { CenteredSpinner } from '../ui/Spinner'

interface ApiToken {
  id: string
  name: string
  token_prefix: string
  scopes: string[]
  expires_at: string | null
  last_used_at: string | null
  created_at: string
}

interface McpAuditEntry {
  id: string
  tool: string
  status: 'ok' | 'error'
  http_status: number | null
  resource_ids: string[]
  error_message: string | null
  duration_ms: number | null
  created_at: string
  token_prefix: string | null
}

type ClientTab = 'cursor' | 'claude-code' | 'claude-desktop' | 'manual'

const CLIENT_CARDS: {
  id: ClientTab
  label: string
  sublabel: string
  icon: React.ReactNode
}[] = [
  {
    id: 'cursor',
    label: 'Cursor',
    sublabel: 'One-click install',
    icon: <CursorIcon size={22} />,
  },
  {
    id: 'claude-code',
    label: 'Claude Code',
    sublabel: 'Terminal & IDE extension',
    icon: <ClaudeIcon size={22} />,
  },
  {
    id: 'claude-desktop',
    label: 'Claude app',
    sublabel: 'Desktop, web & mobile',
    icon: <ClaudeIcon size={22} />,
  },
  {
    id: 'manual',
    label: 'Other clients',
    sublabel: 'Any MCP client',
    icon: <Terminal size={20} className="text-fg-secondary" />,
  },
]

export function ConnectionsTab() {
  const queryClient = useQueryClient()
  const [clientTab, setClientTab] = useState<ClientTab>('cursor')
  const [copied, setCopied] = useState<string | null>(null)

  const connectInfo = useQuery({
    queryKey: ['mcp-connect-info'],
    queryFn: async () => resolveMcpConnectInfo(await api.get<McpConnectInfo>('/mcp/connect-info')),
  })

  const tokens = useQuery({
    queryKey: ['api-tokens'],
    queryFn: () => api.get<ApiToken[]>('/users/me/api-tokens'),
  })

  const auditLog = useQuery({
    queryKey: ['mcp-audit'],
    queryFn: () => api.get<McpAuditEntry[]>('/mcp/audit?limit=20'),
    enabled: (tokens.data?.length ?? 0) > 0,
  })

  const revoke = useMutation({
    mutationFn: (id: string) => api.delete(`/users/me/api-tokens/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['api-tokens'] })
      toast.success('Access revoked')
    },
    onError: (err) => toast.error(errorMessage(err)),
  })

  const copyText = async (key: string, text: string, message: string) => {
    try {
      await navigator.clipboard.writeText(text)
      setCopied(key)
      toast.success(message)
      setTimeout(() => setCopied(null), 2000)
    } catch {
      toast.error('Could not copy to clipboard')
    }
  }

  if (connectInfo.isLoading) return <CenteredSpinner className="py-16" />
  if (connectInfo.isError || !connectInfo.data) {
    return (
      <p className="text-sm text-fg-secondary">Could not load MCP settings. Check that the API is running.</p>
    )
  }

  const info = connectInfo.data
  const manualJson = JSON.stringify(info.cursor_config, null, 2)
  const claudeJson = JSON.stringify(info.claude_config, null, 2)
  const cursorJson = JSON.stringify(info.cursor_config, null, 2)
  const activeConnections = tokens.data?.length ?? 0
  const isConnected = activeConnections > 0
  const mcpUrlIsLocal = isLoopbackUrl(info.mcp_url)

  return (
    <div className="space-y-7">
      <section className="flex flex-wrap items-start justify-between gap-3">
        <div className="max-w-2xl space-y-1">
          <h3 className="text-sm font-semibold text-fg">Connect FlowDesk to your AI agent</h3>
          <p className="text-sm leading-relaxed text-fg-muted">
            Search tasks, update projects, and manage your inbox from your AI tools — secured with OAuth
            sign-in, never manual API keys.
          </p>
        </div>
        <span
          className={cn(
            'inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-medium',
            isConnected
              ? 'border-emerald-500/25 bg-emerald-500/10 text-emerald-400'
              : 'border-ink-700 bg-ink-900 text-fg-muted',
          )}
        >
          <span className={cn('h-1.5 w-1.5 rounded-full', isConnected ? 'bg-emerald-400' : 'bg-ink-600')} />
          {isConnected
            ? `Connected · ${activeConnections} client${activeConnections === 1 ? '' : 's'}`
            : 'Not connected'}
        </span>
      </section>

      <section>
        <p className="mb-2.5 text-[11px] font-semibold uppercase tracking-wide text-fg-muted">
          Choose your client
        </p>
        <div className="grid max-w-3xl grid-cols-2 gap-2 sm:grid-cols-4">
          {CLIENT_CARDS.map((card) => (
            <button
              key={card.id}
              type="button"
              onClick={() => setClientTab(card.id)}
              className={cn(
                'group flex flex-col items-start gap-2 rounded-xl border p-3 text-left transition-all',
                clientTab === card.id
                  ? 'border-brand/60 bg-brand-soft/40 shadow-[0_0_0_1px_var(--brand)]'
                  : 'border-ink-700 bg-ink-900 hover:border-ink-600 hover:bg-ink-850',
              )}
            >
              <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-ink-800">
                {card.icon}
              </span>
              <span>
                <span className={cn('block text-xs font-semibold', clientTab === card.id ? 'text-fg' : 'text-fg-secondary')}>
                  {card.label}
                </span>
                <span className="mt-0.5 block text-[10px] leading-tight text-fg-muted">{card.sublabel}</span>
              </span>
            </button>
          ))}
        </div>

        {(clientTab === 'claude-code' || clientTab === 'claude-desktop') && (
          <WhichClaudeHint current={clientTab} onSwitch={setClientTab} />
        )}

        <div className="mt-4 rounded-xl border border-ink-700 bg-ink-900/60 p-5">
          {clientTab === 'cursor' && (
            <div className="space-y-5">
              <SetupStep
                step={1}
                title="Add FlowDesk to Cursor"
                description="One click opens Cursor and installs the server — nothing to copy or configure."
                action={
                  <a href={info.cursor_deeplink} className="btn-primary inline-flex items-center gap-2">
                    <CursorIcon size={16} />
                    Add to Cursor
                  </a>
                }
              />
              <SetupStep
                step={2}
                title="Connect in Cursor"
                description="Cursor opens its MCP settings with FlowDesk listed. Click Connect when prompted."
              />
              <SetupStep
                step={3}
                title="Approve in FlowDesk"
                description="Your browser returns here. Review the permissions and click Authorize — that's it."
                isLast
              />
              <Collapsible icon={<Wrench size={13} />} label="Manual setup">
                <p className="mb-2 text-[11px] leading-relaxed text-fg-muted">
                  If the button doesn't open Cursor, add this to <InlineCode>.cursor/mcp.json</InlineCode> (global:
                  Cursor Settings → Tools &amp; MCP → New MCP server):
                </p>
                <CodeBlock
                  label="mcp.json"
                  code={cursorJson}
                  copied={copied === 'cursor'}
                  onCopy={() => copyText('cursor', cursorJson, 'Cursor config copied')}
                />
              </Collapsible>
            </div>
          )}

          {clientTab === 'claude-code' && (
            <div className="space-y-5">
              <Callout tone="info" icon={<SquareTerminal size={14} />}>
                Works for the <strong className="font-semibold">Claude Code CLI</strong> and the{' '}
                <strong className="font-semibold">VS Code / JetBrains extensions</strong> — they share the same
                configuration. Run the command in any terminal: your system shell, VS Code's integrated terminal, or
                even Cursor's.
              </Callout>

              <SetupStep
                step={1}
                title="Run one command"
                description="Copy and paste into any terminal. Works on Windows (PowerShell), macOS, and Linux. --scope user makes FlowDesk available in every project."
                action={
                  <button
                    type="button"
                    className="btn-primary inline-flex items-center gap-2"
                    onClick={() =>
                      copyText('claudeCode', info.claude_code_install_command, 'Copied — paste in your terminal')
                    }
                  >
                    {copied === 'claudeCode' ? <Check size={15} /> : <Terminal size={15} />}
                    Copy command
                  </button>
                }
              >
                <CodeBlock
                  label="Any terminal"
                  code={info.claude_code_install_command}
                  mono
                  copied={copied === 'claudeCode'}
                  onCopy={() =>
                    copyText('claudeCode', info.claude_code_install_command, 'Copied — paste in your terminal')
                  }
                />
              </SetupStep>

              <SetupStep
                step={2}
                title="Authenticate"
                description={
                  <>
                    Open Claude Code and type <InlineCode>/mcp</InlineCode>, select{' '}
                    <InlineCode>flowdesk</InlineCode>, then choose <strong className="font-medium text-fg">Authenticate</strong>.
                    Or run <InlineCode>claude mcp login flowdesk</InlineCode> directly from your shell.
                  </>
                }
              />

              <SetupStep
                step={3}
                title="Approve in FlowDesk"
                description="Your browser opens this FlowDesk approval page. Sign in if needed, review permissions, and click Authorize."
              />

              <SetupStep
                step={4}
                title="You're connected"
                description={
                  <>
                    Type <InlineCode>/mcp</InlineCode> again — flowdesk should show as connected. Try asking Claude to
                    list your tasks.
                  </>
                }
                isLast
              />

              <Callout tone="warning" icon={<AlertTriangle size={14} />}>
                Claude Code has its <strong className="font-semibold">own login</strong>, separate from claude.ai in
                your browser. The FlowDesk approval uses your FlowDesk account, so it works no matter which Claude
                account your terminal is signed into.
              </Callout>

              <Collapsible icon={<Wrench size={13} />} label="Troubleshooting">
                <div className="space-y-3">
                  <p className="text-[11px] leading-relaxed text-fg-muted">
                    <InlineCode>claude: command not found</InlineCode>? Install Claude Code first —{' '}
                    <InlineCode>irm https://claude.ai/install.ps1 | iex</InlineCode> (Windows PowerShell) or{' '}
                    <InlineCode>curl -fsSL https://claude.ai/install.sh | bash</InlineCode> (macOS / Linux).
                  </p>
                  <p className="text-[11px] leading-relaxed text-fg-muted">
                    Seeing a stale or broken flowdesk entry? Run these to remove it from every scope and re-add it
                    cleanly:
                  </p>
                  <CodeBlock
                    label="Reset flowdesk (run line by line)"
                    code={info.claude_code_reset_command}
                    mono
                    copied={copied === 'claudeReset'}
                    onCopy={() => copyText('claudeReset', info.claude_code_reset_command, 'Reset commands copied')}
                  />
                  <p className="text-[11px] leading-relaxed text-fg-muted">
                    In the VS Code extension, servers are added via the terminal but managed from the{' '}
                    <InlineCode>/mcp</InlineCode> panel in the chat. If flowdesk shows as disabled there, select it and
                    enable it.
                  </p>
                </div>
              </Collapsible>
            </div>
          )}

          {clientTab === 'claude-desktop' && (
            <div className="space-y-5">
              <Callout tone="info" icon={<MonitorSmartphone size={14} />}>
                Connectors are tied to your <strong className="font-semibold">Claude account</strong> — add FlowDesk
                once and it works in the Claude Desktop app, claude.ai in the browser, and the mobile apps.
              </Callout>

              {mcpUrlIsLocal && (
                <Callout tone="warning" icon={<AlertTriangle size={14} />}>
                  Your MCP server URL is <InlineCode>{info.mcp_url}</InlineCode>. Claude connects to custom connectors
                  from Anthropic's cloud, so a localhost URL <strong className="font-semibold">won't be reachable</strong>.
                  Use Cursor or Claude Code for local development, or deploy FlowDesk publicly.
                </Callout>
              )}

              <SetupStep
                step={1}
                title="Add FlowDesk to Claude"
                description="Opens claude.ai with the FlowDesk connector pre-filled. Sign in with the same Claude account you use in the Desktop app."
                action={
                  <a
                    href={info.claude_desktop_deeplink}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="btn-primary inline-flex items-center gap-2"
                  >
                    <ClaudeIcon size={16} />
                    Add to Claude
                    <ExternalLink size={12} className="opacity-70" />
                  </a>
                }
              />

              <SetupStep
                step={2}
                title="Confirm and connect"
                description={
                  <>
                    Review the pre-filled name and URL, click <strong className="font-medium text-fg">Add</strong>,
                    then click <strong className="font-medium text-fg">Connect</strong> next to FlowDesk in your
                    connectors list.
                  </>
                }
              />

              <SetupStep
                step={3}
                title="Approve in FlowDesk"
                description="You'll land on this FlowDesk approval page. Review permissions and click Authorize. FlowDesk then appears in Claude's tools menu."
                isLast
              />

              <Collapsible icon={<Wrench size={13} />} label="Manual setup">
                <p className="mb-2 text-[11px] leading-relaxed text-fg-muted">
                  In Claude, go to <strong className="font-medium text-fg-secondary">Settings → Connectors → Add custom
                  connector</strong>, name it <InlineCode>FlowDesk</InlineCode>, and paste this URL:
                </p>
                <CodeBlock
                  label="Remote MCP server URL"
                  code={info.mcp_url}
                  mono
                  copied={copied === 'claudeUrl'}
                  onCopy={() => copyText('claudeUrl', info.mcp_url, 'MCP URL copied')}
                />
                <p className="mb-2 mt-3 text-[11px] leading-relaxed text-fg-muted">
                  Running a <strong className="font-medium text-fg-secondary">local MCP server</strong> in Claude
                  Desktop instead? Use <InlineCode>claude_desktop_config.json</InlineCode>:
                </p>
                <CodeBlock
                  label="claude_desktop_config.json"
                  code={claudeJson}
                  copied={copied === 'claude'}
                  onCopy={() => copyText('claude', claudeJson, 'Claude config copied')}
                />
              </Collapsible>
            </div>
          )}

          {clientTab === 'manual' && (
            <div className="space-y-5">
              <SetupStep
                step={1}
                title="Use the remote MCP URL"
                description="Any MCP client that supports Streamable HTTP with OAuth can connect using this endpoint."
                action={
                  <button
                    type="button"
                    className="btn-secondary gap-1.5 text-xs"
                    onClick={() => copyText('url', info.mcp_url, 'MCP URL copied')}
                  >
                    {copied === 'url' ? <Check size={13} /> : <Link2 size={13} />}
                    Copy URL
                  </button>
                }
              >
                <CodeBlock
                  label="MCP URL"
                  code={info.mcp_url}
                  mono
                  copied={copied === 'url'}
                  onCopy={() => copyText('url', info.mcp_url, 'MCP URL copied')}
                />
              </SetupStep>

              <SetupStep
                step={2}
                title="OAuth is automatic"
                description={
                  <>
                    Clients discover authorization automatically from{' '}
                    <InlineCode>{info.oauth_issuer}</InlineCode>. On first connect, your browser opens the FlowDesk
                    approval page.
                  </>
                }
                isLast
              >
                <CodeBlock
                  label="mcp.json"
                  code={manualJson}
                  copied={copied === 'manual'}
                  onCopy={() => copyText('manual', manualJson, 'Config copied')}
                />
              </SetupStep>
            </div>
          )}
        </div>

        <div className="mt-3 flex items-start gap-2 px-1 text-[11px] leading-relaxed text-fg-muted">
          <ShieldCheck size={13} className="mt-0.5 shrink-0 text-emerald-500" />
          <p>
            Connections use OAuth with a scoped, revocable token. Your agent gets exactly the permissions your
            FlowDesk role allows — nothing more.
          </p>
        </div>
      </section>

      {tokens.isLoading ? (
        <CenteredSpinner className="py-6" />
      ) : (tokens.data?.length ?? 0) > 0 ? (
        <section>
          <h3 className="mb-2.5 text-sm font-semibold text-fg">Authorized clients</h3>
          <div className="overflow-hidden rounded-xl border border-ink-700">
            {tokens.data!.map((t) => (
              <div
                key={t.id}
                className="flex items-center gap-3 border-b border-ink-700/60 bg-ink-900 px-4 py-2.5 last:border-b-0"
              >
                <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-ink-800">
                  <TokenClientIcon name={t.name} />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm text-fg">{t.name}</p>
                  <p className="text-[11px] text-fg-muted">
                    {t.token_prefix}…
                    {t.last_used_at
                      ? ` · last used ${new Date(t.last_used_at).toLocaleDateString()}`
                      : ' · never used'}
                    {t.expires_at ? ` · expires ${new Date(t.expires_at).toLocaleDateString()}` : ''}
                  </p>
                </div>
                <button
                  type="button"
                  className="shrink-0 rounded-lg p-2 text-fg-muted transition-colors hover:bg-ink-800 hover:text-red-400"
                  title="Revoke access"
                  disabled={revoke.isPending}
                  onClick={() => revoke.mutate(t.id)}
                >
                  <Trash2 size={15} />
                </button>
              </div>
            ))}
          </div>
        </section>
      ) : null}

      {isConnected && (
        <section>
          <div className="mb-2.5 flex items-center gap-2">
            <History size={14} className="text-fg-muted" />
            <h3 className="text-sm font-semibold text-fg">Recent MCP activity</h3>
          </div>
          {auditLog.isLoading ? (
            <CenteredSpinner className="py-4" />
          ) : (auditLog.data?.length ?? 0) > 0 ? (
            <div className="overflow-hidden rounded-xl border border-ink-700">
              {auditLog.data!.map((entry) => (
                <div
                  key={entry.id}
                  className="flex items-start gap-3 border-b border-ink-700/60 bg-ink-900 px-4 py-2.5 last:border-b-0"
                >
                  <div
                    className={cn(
                      'mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg',
                      entry.status === 'ok' ? 'bg-emerald-500/15 text-emerald-400' : 'bg-red-500/15 text-red-400',
                    )}
                  >
                    {entry.status === 'ok' ? <Check size={13} /> : <AlertTriangle size={13} />}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-mono text-xs text-fg">{entry.tool}</p>
                    <p className="mt-0.5 text-[11px] text-fg-muted">
                      {new Date(entry.created_at).toLocaleString()}
                      {entry.duration_ms != null ? ` · ${entry.duration_ms}ms` : ''}
                    </p>
                    {entry.error_message && (
                      <p className="mt-1 line-clamp-2 text-[11px] text-red-400/90">{entry.error_message}</p>
                    )}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <p className="rounded-xl border border-ink-700 bg-ink-900 px-4 py-3 text-xs text-fg-muted">
              No tool calls recorded yet. Activity appears here after your MCP client uses FlowDesk tools.
            </p>
          )}
        </section>
      )}
    </div>
  )
}

function WhichClaudeHint({
  current,
  onSwitch,
}: {
  current: 'claude-code' | 'claude-desktop'
  onSwitch: (tab: ClientTab) => void
}) {
  const other = current === 'claude-code' ? 'claude-desktop' : 'claude-code'
  return (
    <div className="mt-3 flex items-start gap-2 rounded-lg border border-ink-700 bg-ink-900 px-3 py-2.5">
      <HelpCircle size={13} className="mt-0.5 shrink-0 text-fg-muted" />
      <p className="text-[11px] leading-relaxed text-fg-muted">
        <strong className="font-medium text-fg-secondary">Not sure which Claude you use?</strong>{' '}
        {current === 'claude-code' ? (
          <>
            Claude Code runs in a <strong className="font-medium text-fg-secondary">terminal or code editor</strong>.
            If you chat with Claude in its own app window or at claude.ai,{' '}
            <button type="button" className="font-medium text-brand hover:underline" onClick={() => onSwitch(other)}>
              use the Claude app setup instead
            </button>
            .
          </>
        ) : (
          <>
            This is for the <strong className="font-medium text-fg-secondary">Claude chat app and claude.ai</strong>.
            If you use Claude inside a terminal, VS Code, or another editor,{' '}
            <button type="button" className="font-medium text-brand hover:underline" onClick={() => onSwitch(other)}>
              use the Claude Code setup instead
            </button>
            .
          </>
        )}
      </p>
    </div>
  )
}

function TokenClientIcon({ name }: { name: string }) {
  if (/cursor/i.test(name)) return <CursorIcon size={16} />
  if (/claude/i.test(name)) return <ClaudeIcon size={16} />
  if (/mcp/i.test(name)) return <Globe size={14} className="text-fg-muted" />
  return <ExternalLink size={14} className="text-fg-muted" />
}

function Callout({
  tone,
  icon,
  children,
}: {
  tone: 'info' | 'warning'
  icon: React.ReactNode
  children: React.ReactNode
}) {
  return (
    <div
      className={cn(
        'flex items-start gap-2.5 rounded-lg border px-3 py-2.5 text-[11px] leading-relaxed',
        tone === 'info' && 'border-brand/20 bg-brand-soft/30 text-fg-muted',
        tone === 'warning' && 'border-amber-500/25 bg-amber-500/10 text-fg-muted',
      )}
    >
      <span className={cn('mt-0.5 shrink-0', tone === 'info' ? 'text-brand' : 'text-amber-400')}>{icon}</span>
      <p>{children}</p>
    </div>
  )
}

function SetupStep({
  step,
  title,
  description,
  action,
  children,
  isLast,
}: {
  step: number
  title: string
  description: React.ReactNode
  action?: React.ReactNode
  children?: React.ReactNode
  isLast?: boolean
}) {
  return (
    <div className="relative flex gap-3.5">
      {!isLast && <span className="absolute left-[13px] top-8 h-[calc(100%-16px)] w-px bg-ink-700" aria-hidden />}
      <span className="z-10 flex h-[27px] w-[27px] shrink-0 items-center justify-center rounded-full border border-ink-600 bg-ink-800 text-[11px] font-semibold text-fg-secondary">
        {step}
      </span>
      <div className={cn('min-w-0 flex-1', !isLast && 'pb-1')}>
        <h4 className="pt-1 text-sm font-semibold text-fg">{title}</h4>
        <p className="mt-1 text-xs leading-relaxed text-fg-muted">{description}</p>
        {action && <div className="mt-3">{action}</div>}
        {children && <div className="mt-3">{children}</div>}
      </div>
    </div>
  )
}

function Collapsible({
  icon,
  label,
  children,
}: {
  icon: React.ReactNode
  label: string
  children: React.ReactNode
}) {
  const [open, setOpen] = useState(false)
  return (
    <div className="rounded-lg border border-ink-700/70">
      <button
        type="button"
        className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-[11px] font-medium text-fg-secondary transition-colors hover:text-fg"
        onClick={() => setOpen((v) => !v)}
      >
        <span className="inline-flex items-center gap-1.5">
          {icon}
          {label}
        </span>
        <ChevronDown size={13} className={cn('transition-transform', open && 'rotate-180')} />
      </button>
      {open && <div className="border-t border-ink-700/70 px-3 py-3">{children}</div>}
    </div>
  )
}

function InlineCode({ children }: { children: React.ReactNode }) {
  return <code className="rounded bg-ink-800 px-1 py-0.5 font-mono text-[11px]">{children}</code>
}

function CodeBlock({
  label,
  code,
  mono,
  copied,
  onCopy,
}: {
  label: string
  code: string
  mono?: boolean
  copied?: boolean
  onCopy?: () => void
}) {
  return (
    <div className="overflow-hidden rounded-xl border border-ink-700 bg-ink-950/80">
      <div className="flex items-center justify-between border-b border-ink-700/80 px-3 py-2">
        <span className="text-[11px] font-medium text-fg-muted">{label}</span>
        {onCopy && (
          <button type="button" onClick={onCopy} className="btn-ghost gap-1 px-2 py-1 text-[11px]">
            {copied ? <Check size={12} /> : <Copy size={12} />}
            {copied ? 'Copied' : 'Copy'}
          </button>
        )}
      </div>
      <pre
        className={cn(
          'max-h-40 overflow-x-auto p-3 text-[12px] leading-relaxed text-fg-secondary',
          mono && 'font-mono',
        )}
      >
        {code}
      </pre>
    </div>
  )
}
