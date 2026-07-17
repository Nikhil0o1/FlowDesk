/** FlowDesk MCP scopes — must match backend app/core/api_token_scopes.py */
export const SCOPES = {
  TASKS_READ: 'tasks:read',
  TASKS_WRITE: 'tasks:write',
  PROJECTS_READ: 'projects:read',
  INBOX_READ: 'inbox:read',
  INBOX_WRITE: 'inbox:write',
  COMMENTS_WRITE: 'comments:write',
  SEARCH_READ: 'search:read',
  SPRINTS_READ: 'sprints:read',
  SPRINTS_WRITE: 'sprints:write',
  TIME_READ: 'time:read',
  TIME_WRITE: 'time:write',
  MEMBERS_READ: 'members:read',
  TEMPLATES_READ: 'templates:read',
  TEMPLATES_WRITE: 'templates:write',
  CHAT_READ: 'chat:read',
  CHAT_WRITE: 'chat:write',
  DOCS_READ: 'docs:read',
  DOCS_WRITE: 'docs:write',
  FORMS_READ: 'forms:read',
  WHITEBOARDS_READ: 'whiteboards:read',
  GITHUB_READ: 'github:read',
  GITHUB_WRITE: 'github:write',
} as const

export type Scope = (typeof SCOPES)[keyof typeof SCOPES]

export const ALL_SCOPES: Scope[] = Object.values(SCOPES)

export function requireScopes(have: string[] | undefined, required: Scope[]): void {
  if (!have?.length) return
  const missing = required.filter((s) => !have.includes(s))
  if (missing.length) {
    throw new Error(`Token missing scope(s): ${missing.join(', ')}`)
  }
}
