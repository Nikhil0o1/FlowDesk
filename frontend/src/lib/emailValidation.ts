export const INVITE_EMAIL_PATTERN =
  /^(?=.{1,254}$)(?=.{1,64}@)([A-Za-z0-9]+(?:[._%+-][A-Za-z0-9]+)*)@(?:[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?\.)+[A-Za-z]{2,63}$/

export const INVITE_EMAIL_ERROR = 'Please enter a valid email address'

const PROVIDER_TYPO_RE = /^(gmail|googlemail|outlook|hotmail|live|msn)[a-z0-9]+$/i

const GMAIL_DOMAINS = new Set(['gmail.com', 'googlemail.com'])

/** Microsoft consumer mail — includes country / regional TLDs. */
const MICROSOFT_DOMAINS = new Set([
  'outlook.com',
  'outlook.in',
  'outlook.co.in',
  'outlook.co.uk',
  'outlook.de',
  'outlook.fr',
  'outlook.es',
  'outlook.it',
  'outlook.jp',
  'outlook.com.au',
  'outlook.sg',
  'outlook.hk',
  'hotmail.com',
  'hotmail.co.uk',
  'hotmail.fr',
  'hotmail.de',
  'hotmail.it',
  'hotmail.es',
  'hotmail.in',
  'hotmail.co.in',
  'hotmail.com.br',
  'live.com',
  'live.co.uk',
  'live.in',
  'live.fr',
  'live.nl',
  'live.com.au',
  'live.ca',
  'msn.com',
])

const PROVIDER_DOMAINS: Record<string, Set<string>> = {
  gmail: GMAIL_DOMAINS,
  googlemail: GMAIL_DOMAINS,
  outlook: MICROSOFT_DOMAINS,
  hotmail: MICROSOFT_DOMAINS,
  live: MICROSOFT_DOMAINS,
  msn: MICROSOFT_DOMAINS,
}

function providerDomainAllowed(domain: string): boolean {
  const normalized = domain.toLowerCase()
  const label = normalized.split('.', 1)[0]

  if (PROVIDER_TYPO_RE.test(label)) return false

  const allowed = PROVIDER_DOMAINS[label]
  if (allowed) return allowed.has(normalized)

  return true
}

export function isValidInviteEmail(email: string): boolean {
  const trimmed = email.trim()
  if (!trimmed) return false
  if (!INVITE_EMAIL_PATTERN.test(trimmed)) return false
  const domain = trimmed.split('@', 2)[1]
  return domain ? providerDomainAllowed(domain) : false
}
