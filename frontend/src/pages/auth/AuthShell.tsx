import type { ReactNode } from 'react'

export function AuthShell({
  children,
  aside,
}: {
  children: ReactNode
  aside?: ReactNode
}) {
  return (
    <div className="min-h-screen bg-white font-sans text-slate-900">
      <div className="grid min-h-screen lg:grid-cols-[minmax(520px,1.35fr)_minmax(380px,0.65fr)]">
        {aside ?? <AuthDefaultAside />}

        <main className="flex min-h-screen flex-col bg-white">
          <div className="mx-auto flex w-full max-w-[400px] flex-1 flex-col justify-center px-6 py-10">
            {children}
          </div>
          <footer className="pb-7 text-center text-xs font-medium text-slate-400">
            Need help?{' '}
            <a href="mailto:support@brightcone.ai" className="text-[#0B8FE8] hover:underline">
              Contact support
            </a>
          </footer>
        </main>
      </div>
    </div>
  )
}

function AuthDefaultAside() {
  return (
    <AuthMarketingAside
      badge="Welcome back"
      title={
        <>
          Work flows better
          <br />
          when teams do.
        </>
      }
      description="FlowDesk brings your tasks, teams, and tools into one clean workspace - built for orgs that move fast."
      points={[
        { icon: 'boards', text: 'Visual project boards with real-time updates' },
        { icon: 'team', text: 'Team management with role-based permissions' },
        { icon: 'ai', text: 'AI assistant across every task and project' },
        { icon: 'api', text: 'REST API and webhooks for your stack' },
      ]}
    />
  )
}

export function AuthMarketingAside({
  badge,
  title,
  description,
  points,
}: {
  badge: string
  title: ReactNode
  description: string
  points: { icon: 'boards' | 'team' | 'ai' | 'api'; text: string }[]
}) {
  return (
    <section className="relative hidden overflow-hidden bg-gradient-to-br from-[#061B4F] via-[#073B8E] to-[#0589C8] px-10 py-10 text-white lg:flex lg:flex-col">
      <div className="absolute -bottom-32 -left-28 h-64 w-64 rounded-full bg-[#04C7B4]/20" />
      <div className="absolute -right-24 -top-24 h-80 w-80 rounded-full bg-[#27A8FF]/25" />

      <div className="relative z-10 flex items-center gap-3">
        <img src="/brightcone icon.png" alt="FlowDesk" className="h-6 w-6" />
        <span className="text-sm font-bold tracking-tight">FlowDesk</span>
      </div>

      <div className="relative z-10 flex flex-1 items-center">
        <div className="max-w-md -translate-y-6">
          <div className="mb-5 inline-flex items-center gap-2 rounded-full border border-white/20 bg-white/10 px-3 py-1 text-xs font-medium text-white/90">
            {badge}
          </div>
          <h1 className="text-[34px] font-extrabold leading-[1.05] tracking-tight">{title}</h1>
          <p className="mt-5 max-w-[320px] text-sm leading-6 text-white/78">{description}</p>
        </div>
      </div>

      <div className="relative z-10 mb-2 space-y-3 text-sm font-medium leading-6 text-white/78">
        {points.map((point) => (
          <FeatureLine key={point.text} icon={point.icon} text={point.text} />
        ))}
      </div>
    </section>
  )
}

export function AuthLogo() {
  return (
    <div className="mb-6 flex items-center justify-center gap-3 lg:hidden">
      <img src="/brightcone icon.png" alt="FlowDesk" className="h-7 w-7" />
      <span className="text-sm font-bold text-slate-900">FlowDesk</span>
    </div>
  )
}

function FeatureLine({ icon, text }: { icon: 'boards' | 'team' | 'ai' | 'api'; text: string }) {
  return (
    <p className="flex items-center gap-3">
      <span className="flex h-5 w-5 items-center justify-center text-white/65">
        <FeatureIcon icon={icon} />
      </span>
      <span>{text}</span>
    </p>
  )
}

function FeatureIcon({ icon }: { icon: 'boards' | 'team' | 'ai' | 'api' }) {
  const common = {
    width: 15,
    height: 15,
    viewBox: '0 0 16 16',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 1.7,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
  }

  if (icon === 'boards') {
    return (
      <svg {...common}>
        <rect x="3" y="3" width="4" height="4" rx="0.8" />
        <rect x="9" y="3" width="4" height="4" rx="0.8" />
        <rect x="3" y="9" width="4" height="4" rx="0.8" />
      </svg>
    )
  }

  if (icon === 'team') {
    return (
      <svg {...common}>
        <circle cx="6" cy="5" r="2" />
        <path d="M2.8 12c0-1.8 1.4-3.1 3.2-3.1s3.2 1.3 3.2 3.1" />
        <path d="M10 7c1.2 0 2.2-0.9 2.2-2.1" />
        <path d="M10.8 9.2c1.4 0.2 2.4 1.2 2.4 2.8" />
      </svg>
    )
  }

  if (icon === 'ai') {
    return (
      <svg {...common}>
        <path d="M8 2.5l0.8 2.7L11.5 6 8.8 6.8 8 9.5 7.2 6.8 4.5 6l2.7-0.8L8 2.5z" />
        <path d="M12 9.5l0.4 1.1 1.1 0.4-1.1 0.4-0.4 1.1-0.4-1.1-1.1-0.4 1.1-0.4 0.4-1.1z" />
      </svg>
    )
  }

  return (
    <svg {...common}>
      <path d="M5.5 4.5L2.5 8l3 3.5" />
      <path d="M10.5 4.5l3 3.5-3 3.5" />
      <path d="M9 3.5l-2 9" />
    </svg>
  )
}

export function MicrosoftIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 23 23">
      <path fill="#F25022" d="M1 1h10v10H1z" />
      <path fill="#7FBA00" d="M12 1h10v10H12z" />
      <path fill="#00A4EF" d="M1 12h10v10H1z" />
      <path fill="#FFB900" d="M12 12h10v10H12z" />
    </svg>
  )
}

export function GoogleIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 48 48">
      <path
        fill="#FFC107"
        d="M43.611 20.083H42V20H24v8h11.303c-1.649 4.657-6.08 8-11.303 8-6.627 0-12-5.373-12-12s5.373-12 12-12c3.059 0 5.842 1.154 7.961 3.039l5.657-5.657C34.046 6.053 29.268 4 24 4 12.955 4 4 12.955 4 24s8.955 20 20 20 20-8.955 20-20c0-1.341-.138-2.65-.389-3.917z"
      />
      <path
        fill="#FF3D00"
        d="m6.306 14.691 6.571 4.819C14.655 15.108 18.961 12 24 12c3.059 0 5.842 1.154 7.961 3.039l5.657-5.657C34.046 6.053 29.268 4 24 4 16.318 4 9.656 8.337 6.306 14.691z"
      />
      <path
        fill="#4CAF50"
        d="M24 44c5.166 0 9.86-1.977 13.409-5.192l-6.19-5.238A11.91 11.91 0 0 1 24 36c-5.202 0-9.619-3.317-11.283-7.946l-6.522 5.025C9.505 39.556 16.227 44 24 44z"
      />
      <path
        fill="#1976D2"
        d="M43.611 20.083H42V20H24v8h11.303a12.04 12.04 0 0 1-4.087 5.571l.003-.002 6.19 5.238C36.971 39.205 44 34 44 24c0-1.341-.138-2.65-.389-3.917z"
      />
    </svg>
  )
}
