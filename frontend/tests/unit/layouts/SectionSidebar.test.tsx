import { screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { api } from '@/lib/api'
import { useCalendarStatus } from '@/lib/googleCalendar'
import { useSpaces, useUserRoles } from '@/lib/queries'
import { mockUser } from '@tests/fixtures'
import { mockCalendarEvent, mockFormDef, mockWhiteboard } from '@tests/mockData'
import { renderWithProviders } from '@tests/renderWithProviders'
import { setupPopulatedApiMock, setupPopulatedQueryMocks } from '@tests/smokeMocks'
import { useAuthStore } from '@/stores/auth'
import { sectionFromPath, SectionSidebar } from '@/layouts/SectionSidebar'

vi.mock('@/lib/googleCalendar', () => ({
  useCalendarStatus: vi.fn(() => ({
    isLoading: false,
    data: { google: { connected: false, configured: false }, outlook: { configured: false } },
  })),
  startGoogleConnect: vi.fn(),
}))

describe('sectionFromPath', () => {
  it('maps app paths to section keys', () => {
    expect(sectionFromPath('/app/dashboard')).toBe('home')
    expect(sectionFromPath('/app/planner')).toBe('planner')
    expect(sectionFromPath('/app/teams')).toBe('teams')
    expect(sectionFromPath('/app/whiteboards/wb-1')).toBe('whiteboards')
    expect(sectionFromPath('/app/forms/form-1')).toBe('forms')
    expect(sectionFromPath('/app/timesheet')).toBe('timesheet')
    expect(sectionFromPath('/app/apps')).toBe('apps')
  })
})

describe('SectionSidebar', () => {
  beforeEach(() => {
    useAuthStore.setState({
      user: mockUser,
      loginContext: null,
      initialized: true,
      accessToken: 'test-token',
    })
    setupPopulatedQueryMocks()
    setupPopulatedApiMock()
    vi.mocked(useSpaces).mockReturnValue({
      data: [{ id: 'space-1', workspace_id: 'ws-1', name: 'Default', color: '#2B88EE', position: 0, created_at: '2024-01-01T00:00:00Z' }],
      isLoading: false,
    } as ReturnType<typeof useSpaces>)
  })

  it('renders home sidebar with inbox and projects', () => {
    renderWithProviders(<SectionSidebar section="home" />)
    expect(screen.getAllByText('Inbox').length).toBeGreaterThanOrEqual(1)
    expect(screen.getAllByText('My Tasks').length).toBeGreaterThanOrEqual(1)
    expect(screen.getByText('Alpha Project')).toBeInTheDocument()
  })

  it('renders planner sidebar with calendar connect CTA', () => {
    renderWithProviders(<SectionSidebar section="planner" />)
    expect(screen.getByText('Planner')).toBeInTheDocument()
    expect(screen.getByText(/Connect your calendar/i)).toBeInTheDocument()
    expect(screen.getByText('Google Calendar')).toBeInTheDocument()
  })

  it('renders planner sidebar with upcoming events when connected', async () => {
    vi.mocked(useCalendarStatus).mockReturnValue({
      isLoading: false,
      data: {
        google: { connected: true, configured: true, account_email: 'test@example.com', scopes: { calendar: true } },
        outlook: { configured: false },
      },
    } as ReturnType<typeof useCalendarStatus>)
    vi.mocked(api.get).mockImplementation(async (url: string) => {
      if (url.includes('/calendar/events')) return [mockCalendarEvent()]
      return {}
    })
    renderWithProviders(<SectionSidebar section="planner" />)
    expect(screen.getByText('Upcoming')).toBeInTheDocument()
    expect(await screen.findByText('Team standup')).toBeInTheDocument()
  })

  it('renders teams sidebar', () => {
    vi.mocked(useUserRoles).mockReturnValue({
      data: {
        highest_role: 'org_owner',
        org_role: 'owner',
        org_name: 'Acme Corp',
        workspace_roles: [],
        space_roles: [],
        project_roles: [],
      },
      isLoading: false,
    } as ReturnType<typeof useUserRoles>)
    renderWithProviders(<SectionSidebar section="teams" />)
    expect(screen.getByText('All Teams')).toBeInTheDocument()
    expect(screen.getByText('All People')).toBeInTheDocument()
    expect(screen.getByText('Engineering')).toBeInTheDocument()
  })

  it('renders whiteboards sidebar', () => {
    renderWithProviders(<SectionSidebar section="whiteboards" />)
    expect(screen.getByText('All Whiteboards')).toBeInTheDocument()
    expect(screen.getByText(mockWhiteboard().name)).toBeInTheDocument()
  })

  it('renders forms sidebar', () => {
    renderWithProviders(<SectionSidebar section="forms" />)
    expect(screen.getByText('All Forms')).toBeInTheDocument()
    expect(screen.getByText(mockFormDef().name)).toBeInTheDocument()
  })

  it('renders timesheet sidebar', () => {
    renderWithProviders(<SectionSidebar section="timesheet" />)
    expect(screen.getByText('My timesheet')).toBeInTheDocument()
    expect(screen.getByText('Time entries')).toBeInTheDocument()
  })

  it('renders apps sidebar', () => {
    renderWithProviders(<SectionSidebar section="apps" />)
    expect(screen.getByRole('heading', { name: 'App Center' })).toBeInTheDocument()
    expect(screen.getByText('All Apps')).toBeInTheDocument()
    expect(screen.getByText('GitHub')).toBeInTheDocument()
  })
})
