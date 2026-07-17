import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import { AddPeopleChoiceModal } from '@/components/people/AddPeopleChoiceModal'
import { renderWithProviders } from '@tests/renderWithProviders'

describe('AddPeopleChoiceModal', () => {
  it('offers new and existing people paths', async () => {
    const user = userEvent.setup()
    const onNewPeople = vi.fn()
    const onExistingPeople = vi.fn()

    renderWithProviders(
      <AddPeopleChoiceModal
        open
        onClose={vi.fn()}
        onNewPeople={onNewPeople}
        onExistingPeople={onExistingPeople}
      />,
    )

    expect(screen.getByText('New people')).toBeInTheDocument()
    expect(screen.getByText('Existing people')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /new people/i }))
    expect(onNewPeople).toHaveBeenCalled()

    await user.click(screen.getByRole('button', { name: /existing people/i }))
    expect(onExistingPeople).toHaveBeenCalled()
  })
})
