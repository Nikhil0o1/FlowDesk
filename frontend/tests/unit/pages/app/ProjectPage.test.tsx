import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { Route, Routes } from 'react-router-dom'

import { api } from '@/lib/api'
import { mockCurrentContext, mockProject, mockUser } from '@tests/fixtures'
import { emptyPage, mockStatus, mockTask } from '@tests/mockData'
import { renderWithProviders } from '@tests/renderWithProviders'
import { useAuthStore } from '@/stores/auth'
import ProjectPage from '@/pages/app/ProjectPage'
import { useProject, useProjectTasks, useSpaces, useStatuses } from '@/lib/queries'

const views = ['list', 'board', 'calendar', 'gantt', 'table', 'activity', 'github'] as const

describe('ProjectPage', () => {
  beforeEach(() => {
    useAuthStore.setState({
      user: mockUser,
      loginContext: null,
      initialized: true,
      accessToken: 'test-token',
    })
    vi.mocked(useProject).mockReturnValue({
      data: mockProject,
      isLoading: false,
    } as ReturnType<typeof useProject>)
    vi.mocked(useStatuses).mockReturnValue({
      data: [mockStatus],
      isLoading: false,
    } as ReturnType<typeof useStatuses>)
    vi.mocked(useSpaces).mockReturnValue({
      data: [{ id: 'space-1', workspace_id: 'ws-1', name: 'General', color: '#2B88EE', icon: null, position: 0, created_at: '2024-01-01T00:00:00Z' }],
      isLoading: false,
    } as ReturnType<typeof useSpaces>)
    vi.mocked(useProjectTasks).mockReturnValue({
      data: { items: [mockTask()], total: 1, page: 1, page_size: 50 },
      isLoading: false,
    } as ReturnType<typeof useProjectTasks>)
    vi.mocked(api.get).mockImplementation(async (url: string) => {
      if (url.includes('/members')) return []
      if (url.includes('/github/')) return emptyPage
      if (url.includes('/activity')) return emptyPage
      return {}
    })
  })

  it.each(views)('renders %s view', async (view) => {
    renderWithProviders(
      <Routes>
        <Route path="/app/projects/:projectId" element={<ProjectPage />} />
      </Routes>,
      { routerProps: { initialEntries: [`/app/projects/proj-1?view=${view}`] } },
    )
    await waitFor(() => {
      expect(screen.getAllByText('Alpha Project').length).toBeGreaterThan(0)
    })
  })

  it('switches views via toolbar', async () => {
    const user = userEvent.setup()
    renderWithProviders(
      <Routes>
        <Route path="/app/projects/:projectId" element={<ProjectPage />} />
      </Routes>,
      { routerProps: { initialEntries: ['/app/projects/proj-1'] } },
    )
    await waitFor(() => {
      expect(screen.getAllByText('Alpha Project').length).toBeGreaterThan(0)
    })
    await user.click(screen.getByRole('button', { name: 'Board' }))
    expect(await screen.findByText('Fix bug')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Calendar' }))
    expect(await screen.findByRole('button', { name: /today/i })).toBeInTheDocument()
  }, 15000)
})
