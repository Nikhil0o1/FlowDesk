import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { api } from '@/lib/api'
import { mockProject } from '@tests/fixtures'
import { mockOrgMember2, mockStatus, mockTask } from '@tests/mockData'
import { renderWithProviders } from '@tests/renderWithProviders'
import { useProject, useStatuses } from '@/lib/queries'
import { formatDate, todayDateKey } from '@/lib/utils'
import { AssigneePicker, PriorityPicker, StatusPicker, TaskDatesPicker } from '@/components/tasks/pickers'

describe('task pickers', () => {
  beforeEach(() => {
    vi.mocked(useStatuses).mockReturnValue({
      data: [mockStatus, { ...mockStatus, id: 'status-2', name: 'In Progress', category: 'active' as const, position: 1 }],
      isLoading: false,
    } as ReturnType<typeof useStatuses>)
    vi.mocked(useProject).mockReturnValue({
      data: mockProject,
      isLoading: false,
    } as ReturnType<typeof useProject>)
    vi.mocked(api.get).mockImplementation(async (url: string) => {
      if (url.includes('/projects/proj-1/members')) return [mockOrgMember2()]
      return []
    })
    vi.mocked(api.post).mockResolvedValue({})
    vi.mocked(api.delete).mockResolvedValue(undefined)
  })

  it('StatusPicker opens menu and selects a status', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    renderWithProviders(
      <StatusPicker projectId="proj-1" value={mockStatus} onChange={onChange} size="md" />,
    )
    await user.click(screen.getByTitle('All statuses'))
    await user.click(screen.getByText('In Progress'))
    expect(onChange).toHaveBeenCalledWith('status-2', expect.objectContaining({ name: 'In Progress' }))
  })

  it('PriorityPicker changes priority', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    renderWithProviders(
      <PriorityPicker value="normal" onChange={onChange}>
        <button type="button">Priority</button>
      </PriorityPicker>,
    )
    await user.click(screen.getByRole('button', { name: 'Priority' }))
    await user.click(screen.getByText('High'))
    expect(onChange).toHaveBeenCalledWith('high')
  })

  it('AssigneePicker toggles assignee', async () => {
    const user = userEvent.setup()
    const task = mockTask({ assignees: [] })
    renderWithProviders(
      <AssigneePicker task={task}>
        <span>+ Assign</span>
      </AssigneePicker>,
    )
    await user.click(screen.getByText('+ Assign'))
    await user.click(screen.getByText('Jane Doe'))
    expect(api.post).toHaveBeenCalledWith('/tasks/task-1/assignees', { user_ids: ['user-2'] })
  })

  it('TaskDatesPicker advances to due date after start is selected', async () => {
    const user = userEvent.setup()
    const onSave = vi.fn()
    renderWithProviders(
      <TaskDatesPicker startDate={null} dueDate={null} completedAt={null} onSave={onSave} />,
    )

    await user.click(screen.getByRole('button', { name: 'Start' }))
    expect(screen.getByRole('button', { name: 'Start', pressed: true })).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Next month' }))
    const [year, month] = todayDateKey().split('-').map(Number)
    const nextMonth = month === 12 ? `${year + 1}-01` : `${year}-${String(month + 1).padStart(2, '0')}`
    await user.click(screen.getByRole('button', { name: `${nextMonth}-15` }))
    expect(onSave).toHaveBeenCalledWith(
      { start_date: expect.stringMatching(/^\d{4}-\d{2}-15$/) },
      expect.any(Function),
    )
    expect(screen.getByRole('button', { name: 'Due', pressed: true })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Start', pressed: true })).not.toBeInTheDocument()
  })

  it('TaskDatesPicker clears start date immediately', async () => {
    const user = userEvent.setup()
    const onSave = vi.fn()
    renderWithProviders(
      <TaskDatesPicker startDate="2026-06-15" dueDate={null} completedAt={null} onSave={onSave} />,
    )

    await user.click(screen.getByRole('button', { name: formatDate('2026-06-15') }))
    await user.click(screen.getByRole('button', { name: 'Clear start' }))

    expect(onSave).toHaveBeenCalledWith({ clear_start_date: true }, expect.any(Function))
    expect(screen.getByRole('button', { name: 'Start' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: formatDate('2026-06-15') })).not.toBeInTheDocument()
  })

  it('TaskDatesPicker clears due date immediately', async () => {
    const user = userEvent.setup()
    const onSave = vi.fn()
    renderWithProviders(
      <TaskDatesPicker startDate="2026-06-01" dueDate="2026-06-20" completedAt={null} onSave={onSave} />,
    )

    await user.click(screen.getByRole('button', { name: formatDate('2026-06-20') }))
    await user.click(screen.getByRole('button', { name: 'Clear due' }))

    expect(onSave).toHaveBeenCalledWith({ clear_due_date: true }, expect.any(Function))
    expect(screen.getByRole('button', { name: 'Due' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: formatDate('2026-06-20') })).not.toBeInTheDocument()
  })
})
