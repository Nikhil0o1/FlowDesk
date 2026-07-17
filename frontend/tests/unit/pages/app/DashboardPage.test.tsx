import { screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { api } from '@/lib/api'
import { useCurrentContext, useProjectMemberDashboard, useUserRoles } from '@/lib/queries'
import { mockCurrentContext } from '@tests/fixtures'
import { renderWithProviders } from '@tests/renderWithProviders'
import DashboardPage from '@/pages/app/DashboardPage'

describe('DashboardPage', () => {
  beforeEach(() => {
    vi.mocked(useCurrentContext).mockReturnValue(mockCurrentContext())
    vi.mocked(useUserRoles).mockReturnValue({ data: undefined, isLoading: false })
    vi.mocked(api.get).mockImplementation(async (url: string) => {
      if (url.includes('/task-stats')) {
        return { total: 0, by_status: [] }
      }
      if (url.includes('/integrations/google/status')) {
        return { configured: false, connected: false }
      }
      return {}
    })
  })

  it('renders workspace overview', async () => {
    renderWithProviders(<DashboardPage />)

    expect(await screen.findByRole('heading', { name: 'Main Workspace' })).toBeInTheDocument()
    expect(screen.getAllByText('Overview').length).toBeGreaterThan(0)
    expect(screen.getByText('Recent')).toBeInTheDocument()
  })

  it('renders project member dashboard when highest role is project_member', async () => {
    vi.mocked(useUserRoles).mockReturnValue({
      data: {
        highest_role: 'project_member',
        org_role: 'member',
        org_name: 'Acme Corp',
        workspace_roles: [{ workspace_id: 'ws-1', workspace_name: 'Main Workspace', role: 'member' }],
        space_roles: [],
        project_roles: [
          {
            project_id: 'p-1',
            project_name: 'Phoenix',
            workspace_id: 'ws-1',
            space_name: 'Ops',
            role: 'member',
          },
        ],
      },
      isLoading: false,
    })
    vi.mocked(useProjectMemberDashboard).mockReturnValue({
      data: {
        project_id: 'p-1',
        project_name: 'Phoenix',
        project_color: '#6366f1',
        space_name: 'Ops',
        my_role: 'member',
        kpis: {
          my_open_tasks: 2,
          my_overdue: 0,
          my_due_today: 1,
          my_due_this_week: 1,
          my_completed_this_week: 3,
          project_completion_percent: 40,
          active_sprint_count: 1,
          trends: {},
        },
        my_task_status_breakdown: [],
        my_task_status_total: 0,
        my_attention_tasks: [],
        my_attention_total: 0,
        active_sprints: [],
        recent_activities: [],
      },
      isLoading: false,
    } as ReturnType<typeof useProjectMemberDashboard>)

    renderWithProviders(<DashboardPage />)

    expect(await screen.findByRole('heading', { name: 'Phoenix' })).toBeInTheDocument()
    expect(screen.getByText('My Task Board')).toBeInTheDocument()
    expect(screen.getByText('Needs My Attention')).toBeInTheDocument()
  })

  it('shows onboarding empty state when workspace is missing', () => {
    vi.mocked(useCurrentContext).mockReturnValue(
      mockCurrentContext({ workspace: null, workspaces: [] }),
    )

    renderWithProviders(<DashboardPage />)

    expect(screen.getByRole('heading', { name: 'Welcome to Acme Corp' })).toBeInTheDocument()
  })
})
