export interface BreadcrumbItem {
  label: string
  href?: string
  current?: boolean
}

export const SETTINGS_TAB_LABELS: Record<string, string> = {
  profile: 'Profile',
  security: 'Security',
  connections: 'MCP',
  'api-keys': 'API Keys',
  organization: 'Organization',
  audit: 'Audit log',
  webhooks: 'Webhooks',
  time: 'My time',
}

export const TEAMS_TAB_LABELS: Record<string, string> = {
  teams: 'Teams',
  people: 'All people',
}

export const FORM_TAB_LABELS: Record<string, string> = {
  builder: 'Builder',
  submissions: 'Submissions',
}

/** Top-level app routes (segment after /app/) */
export const APP_SECTION_LABELS: Record<string, string> = {
  dashboard: 'Overview',
  planner: 'Planner',
  list: 'My tasks',
  teams: 'Teams',
  whiteboards: 'Whiteboards',
  forms: 'Forms',
  timesheet: 'Timesheet',
  apps: 'Apps',
  workspaces: 'Workspaces',
  projects: 'Projects',
  tasks: 'Tasks',
  board: 'Board',
  sprints: 'Sprints',
  chat: 'Chat',
  notifications: 'Notifications',
  replies: 'Replies',
  settings: 'Settings',
  developers: 'Developer Docs',
}

export function dashboardCrumb(): BreadcrumbItem {
  return { label: 'Dashboard', href: '/app/dashboard' }
}

export function workspaceCrumb(id: string, name: string, current = false): BreadcrumbItem {
  return { label: name, href: current ? undefined : `/app/workspaces/${id}`, current }
}

export function projectCrumb(id: string, name: string, current = false): BreadcrumbItem {
  return { label: name, href: current ? undefined : `/app/projects/${id}`, current }
}
