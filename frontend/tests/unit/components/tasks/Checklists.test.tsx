import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { api } from '@/lib/api'
import { mockTaskDetail } from '@tests/mockData'
import { renderWithProviders } from '@tests/renderWithProviders'
import { Checklists } from '@/components/tasks/Checklists'

describe('Checklists', () => {
  beforeEach(() => {
    vi.mocked(api.post).mockResolvedValue({ id: 'cl-new', name: 'Checklist', items: [], position: 0 })
    vi.mocked(api.patch).mockResolvedValue({})
    vi.mocked(api.delete).mockResolvedValue(undefined)
  })

  it('creates a checklist', async () => {
    const user = userEvent.setup()
    renderWithProviders(<Checklists task={mockTaskDetail()} />)
    await user.click(screen.getByRole('button', { name: /create checklist/i }))
    expect(api.post).toHaveBeenCalledWith('/tasks/task-1/checklists', { name: 'Checklist' })
  })

  it('toggles, adds, and deletes checklist items', async () => {
    const user = userEvent.setup()
    const task = mockTaskDetail({
      checklists: [
        {
          id: 'cl-1',
          name: 'QA checklist',
          position: 0,
          items: [{ id: 'cli-1', content: 'Run tests', is_done: false, position: 0 }],
        },
      ],
    })
    renderWithProviders(<Checklists task={task} />)
    expect(screen.getByText('Run tests')).toBeInTheDocument()
    await user.click(screen.getByRole('checkbox'))
    expect(api.patch).toHaveBeenCalledWith('/checklist-items/cli-1', { is_done: true })

    const input = screen.getByPlaceholderText(/add an item/i)
    await user.type(input, 'Deploy{enter}')
    expect(api.post).toHaveBeenCalledWith('/checklists/cl-1/items', { content: 'Deploy' })

    await user.click(screen.getByTitle('Delete checklist'))
    expect(api.delete).toHaveBeenCalledWith('/checklists/cl-1')
  })
})
