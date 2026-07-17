import type { LoginContext, Organization, Project, User, Workspace } from '@/lib/types'

export const mockUser: User = {
  id: 'user-1',
  email: 'test@example.com',
  is_active: true,
  is_platform_superadmin: false,
  auth_provider: 'google',
  last_login_at: null,
  created_at: '2024-01-01T00:00:00Z',
  totp_enabled: false,
  profile: {
    full_name: 'Test User',
    avatar_url: null,
    avatar_color: '#2B88EE',
    status_text: null,
    title: 'Engineer',
    timezone: 'UTC',
    phone: null,
  },
}

export const mockOrg: Organization = {
  id: 'org-1',
  name: 'Acme Corp',
  slug: 'acme',
  logo_url: null,
  is_disabled: false,
  require_2fa: false,
  plan: 'free',
  seats: 10,
  created_at: '2024-01-01T00:00:00Z',
  my_role: 'owner',
}

export const mockWorkspace: Workspace = {
  id: 'ws-1',
  organization_id: 'org-1',
  name: 'Main Workspace',
  description: null,
  color: '#2B88EE',
  icon: null,
  is_archived: false,
  created_at: '2024-01-01T00:00:00Z',
  my_role: 'admin',
}

export const mockProject: Project = {
  id: 'proj-1',
  space_id: 'space-1',
  workspace_id: 'ws-1',
  name: 'Alpha Project',
  description: null,
  color: '#2B88EE',
  icon: null,
  position: 0,
  is_archived: false,
  created_at: '2024-01-01T00:00:00Z',
  my_role: 'admin',
  task_count: 5,
  done_task_count: 2,
}

export const mockLoginContext: LoginContext = {
  kind: 'member',
  role: 'member',
  redirect_to: '/app/dashboard',
  organization_id: 'org-1',
  workspace_id: 'ws-1',
  project_id: null,
}

export function mockCurrentContext(
  overrides: Partial<{
    org: Organization | null
    orgs: Organization[]
    workspace: Workspace | null
    workspaces: Workspace[]
    isLoading: boolean
  }> = {},
) {
  return {
    org: mockOrg,
    orgs: [mockOrg],
    workspace: mockWorkspace,
    workspaces: [mockWorkspace],
    isLoading: false,
    ...overrides,
  }
}
