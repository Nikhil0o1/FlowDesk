import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { api } from '@/lib/api'
import { mockCurrentContext, mockUser } from '@tests/fixtures'
import { renderWithProviders } from '@tests/renderWithProviders'
import { setupPopulatedQueryMocks } from '@tests/smokeMocks'
import { useAuthStore } from '@/stores/auth'
import { useUIStore } from '@/stores/ui'
import { useChannels, useCurrentContext, useProjects, useSpaces, useUserRoles } from '@/lib/queries'
import { Sidebar } from '@/layouts/Sidebar'
import { mockProject } from '@tests/fixtures'

describe('Sidebar', () => {
  beforeEach(() => {
    useAuthStore.setState({
      user: mockUser,
      loginContext: null,
      initialized: true,
      accessToken: 'test-token',
    })
    useUIStore.setState({
      toggleSidebar: vi.fn(),
      setSearchOpen: vi.fn(),
      setInviteOpen: vi.fn(),
    })
    vi.mocked(useCurrentContext).mockReturnValue(mockCurrentContext())
    setupPopulatedQueryMocks()
    vi.mocked(useSpaces).mockReturnValue({
      data: [{ id: 'space-1', workspace_id: 'ws-1', name: 'Default', color: '#2B88EE', position: 0, created_at: '2024-01-01T00:00:00Z' }],
      isLoading: false,
    } as ReturnType<typeof useSpaces>)
    vi.mocked(api.post).mockResolvedValue({ id: 'space-2', name: 'New Space' })
  })

  it('renders channels, spaces, and projects', () => {
    renderWithProviders(<Sidebar />)
    expect(screen.getAllByText('Inbox').length).toBeGreaterThanOrEqual(1)
    expect(screen.getAllByText('My Tasks').length).toBeGreaterThanOrEqual(1)
    expect(screen.getByText('general')).toBeInTheDocument()
    expect(screen.getByText('Alpha Project')).toBeInTheDocument()
  })

  it('filters sidebar items', async () => {
    const user = userEvent.setup()
    renderWithProviders(<Sidebar />)
    await user.click(screen.getByTitle('Filter sidebar'))
    const input = screen.getByPlaceholderText('Filter channels & projects…')
    await user.type(input, 'alpha')
    expect(screen.getByText('Alpha Project')).toBeInTheDocument()
    await user.clear(input)
    await user.type(input, 'nomatch')
    expect(screen.getByText('No matching channels')).toBeInTheDocument()
  })

  it('opens create space modal', async () => {
    const user = userEvent.setup()
    renderWithProviders(<Sidebar />)
    await user.click(screen.getByRole('button', { name: /^Create$/i }))
    await user.click(screen.getByText('Space'))
    expect(await screen.findByRole('heading', { name: 'Create Space' })).toBeInTheDocument()
  })

  it('clears draft space name when the create modal is reopened', async () => {
    const user = userEvent.setup()
    renderWithProviders(<Sidebar />)
    await user.click(screen.getByRole('button', { name: /^Create$/i }))
    await user.click(screen.getByText('Space'))
    const input = await screen.findByPlaceholderText('Space name')
    await user.type(input, 'Draft space')
    await user.keyboard('{Escape}')
    await user.click(screen.getByRole('button', { name: /^Create$/i }))
    await user.click(screen.getByText('Space'))
    expect(await screen.findByPlaceholderText('Space name')).toHaveValue('')
  })

  it('clears draft project fields when the create modal is reopened', async () => {
    const user = userEvent.setup()
    renderWithProviders(<Sidebar />)
    await user.click(screen.getByRole('button', { name: /^Create$/i }))
    await user.click(screen.getByText('Project'))
    const nameInput = await screen.findByPlaceholderText('Project name')
    await user.type(nameInput, 'Draft project')
    await user.keyboard('{Escape}')
    await user.click(screen.getByRole('button', { name: /^Create$/i }))
    await user.click(screen.getByText('Project'))
    expect(await screen.findByPlaceholderText('Project name')).toHaveValue('')
  })

  it('project admin also sees projects they are only a member of', () => {
    vi.mocked(useProjects).mockReturnValue({
      data: [
        mockProject,
        { ...mockProject, id: 'proj-2', name: 'Beta Project', my_role: 'member' },
      ],
      isLoading: false,
    } as ReturnType<typeof useProjects>)
    vi.mocked(useUserRoles).mockReturnValue({
      data: {
        highest_role: 'project_admin',
        org_role: 'member',
        org_name: 'Acme',
        workspace_roles: [],
        space_roles: [],
        project_roles: [
          { project_id: 'proj-1', project_name: 'Alpha Project', space_id: 'space-1', workspace_id: 'ws-1', role: 'admin' },
          { project_id: 'proj-2', project_name: 'Beta Project', space_id: 'space-1', workspace_id: 'ws-1', role: 'member' },
        ],
      },
      isLoading: false,
    } as ReturnType<typeof useUserRoles>)
    renderWithProviders(<Sidebar />)
    expect(screen.getByText('Alpha Project')).toBeInTheDocument()
    expect(screen.getByText('Beta Project')).toBeInTheDocument()
  })

  it('opens search from header', async () => {
    const setSearchOpen = vi.fn()
    useUIStore.setState({ setSearchOpen })
    const user = userEvent.setup()
    renderWithProviders(<Sidebar />)
    await user.click(screen.getByTitle('Search (Ctrl K)'))
    expect(setSearchOpen).toHaveBeenCalledWith(true)
  })
})
