import { fireEvent, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it } from 'vitest'

import { renderWithProviders } from '@tests/renderWithProviders'
import { useToastStore } from '@/stores/toast'
import { Toasts } from '@/components/ui/Toasts'

describe('Toasts', () => {
  beforeEach(() => {
    useToastStore.setState({ toasts: [] })
  })

  it('renders nothing when there are no toasts', () => {
    const { container } = renderWithProviders(<Toasts />)
    expect(container).toBeEmptyDOMElement()
  })

  it('renders toast messages and dismisses on click', () => {
    useToastStore.setState({
      toasts: [{ id: 1, kind: 'success', message: 'Saved successfully' }],
    })

    renderWithProviders(<Toasts />)

    expect(screen.getByText('Saved successfully')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button'))
    expect(useToastStore.getState().toasts).toHaveLength(0)
  })
})
