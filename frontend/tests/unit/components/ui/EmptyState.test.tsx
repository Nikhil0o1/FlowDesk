import { screen } from '@testing-library/react'
import { Inbox } from 'lucide-react'
import { describe, expect, it } from 'vitest'

import { renderWithProviders } from '@tests/renderWithProviders'
import { EmptyState } from '@/components/ui/EmptyState'

describe('EmptyState', () => {
  it('renders title, description, and action', () => {
    renderWithProviders(
      <EmptyState
        icon={Inbox}
        title="Nothing here"
        description="Items will appear once created."
        action={<button type="button">Create item</button>}
      />,
    )

    expect(screen.getByRole('heading', { name: 'Nothing here' })).toBeInTheDocument()
    expect(screen.getByText('Items will appear once created.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Create item' })).toBeInTheDocument()
  })
})
