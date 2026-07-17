import { screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { mockCurrentContext, mockProject } from '@tests/fixtures'
import { renderWithProviders } from '@tests/renderWithProviders'
import BoardPage from '@/pages/app/BoardPage'
import { useProjects, useProjectTasks, useStatuses } from '@/lib/queries'

vi.mock('@/components/tasks/KanbanBoard', () => ({
  KanbanBoard: () => <div data-testid="kanban-board">Kanban Board</div>,
}))

describe('BoardPage', () => {
  beforeEach(() => {
    vi.mocked(useProjects).mockReturnValue({
      data: [mockProject],
      isLoading: false,
    } as ReturnType<typeof useProjects>)
    vi.mocked(useProjectTasks).mockReturnValue({
      data: { items: [], total: 0, page: 1, page_size: 500 },
      isLoading: false,
    } as ReturnType<typeof useProjectTasks>)
    vi.mocked(useStatuses).mockReturnValue({
      data: [],
      isLoading: false,
    } as ReturnType<typeof useStatuses>)
  })

  it('renders board heading and kanban stub', () => {
    renderWithProviders(<BoardPage />)

    expect(screen.getByRole('heading', { name: 'Board' })).toBeInTheDocument()
    expect(screen.getByTestId('kanban-board')).toBeInTheDocument()
  })

  it('shows empty state when there are no projects', () => {
    vi.mocked(useProjects).mockReturnValue({
      data: [],
      isLoading: false,
    } as ReturnType<typeof useProjects>)

    renderWithProviders(<BoardPage />)

    expect(screen.getByRole('heading', { name: 'No projects' })).toBeInTheDocument()
  })
})
