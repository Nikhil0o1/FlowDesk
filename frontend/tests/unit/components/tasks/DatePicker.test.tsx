import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import { DatePicker } from '@/components/tasks/pickers'
import { todayDateKey } from '@/lib/utils'
import { renderWithProviders } from '@tests/renderWithProviders'

describe('DatePicker', () => {
  it('keeps the panel open while browsing months in confirm mode', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    renderWithProviders(
      <DatePicker value={null} onChange={onChange} closeOnSelect={false}>
        <button type="button">Due date</button>
      </DatePicker>,
    )

    await user.click(screen.getByRole('button', { name: 'Due date' }))
    expect(screen.getByLabelText('Date')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Next month' }))
    expect(screen.getByLabelText('Date')).toBeInTheDocument()
    expect(onChange).not.toHaveBeenCalled()
  })

  it('applies the draft date only after Apply is clicked', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    const today = todayDateKey()
    renderWithProviders(
      <DatePicker value={null} onChange={onChange} closeOnSelect={false} min={today}>
        <button type="button">Due date</button>
      </DatePicker>,
    )

    await user.click(screen.getByRole('button', { name: 'Due date' }))
    await user.click(screen.getByRole('button', { name: today }))
    expect(onChange).not.toHaveBeenCalled()

    await user.click(screen.getByRole('button', { name: 'Apply' }))
    expect(onChange).toHaveBeenCalledWith(today)
  })

  it('allows past dates when no min is set', async () => {
    const user = userEvent.setup()
    renderWithProviders(
      <DatePicker value={null} onChange={vi.fn()}>
        <button type="button">Due date</button>
      </DatePicker>,
    )

    await user.click(screen.getByRole('button', { name: 'Due date' }))
    await user.click(screen.getByRole('button', { name: 'Previous month' }))

    const [year, month] = todayDateKey().split('-').map(Number)
    const prevMonth = month === 1 ? `${year - 1}-12` : `${year}-${String(month - 1).padStart(2, '0')}`
    const pastDay = `${prevMonth}-15`
    expect(screen.getByRole('button', { name: pastDay })).not.toBeDisabled()
  })

  it('disables past dates when min is today', async () => {
    const user = userEvent.setup()
    const today = todayDateKey()
    renderWithProviders(
      <DatePicker value={null} onChange={vi.fn()} min={today}>
        <button type="button">Due date</button>
      </DatePicker>,
    )

    await user.click(screen.getByRole('button', { name: 'Due date' }))
    await user.click(screen.getByRole('button', { name: 'Previous month' }))

    const [year, month] = today.split('-').map(Number)
    const prevMonth = month === 1 ? `${year - 1}-12` : `${year}-${String(month - 1).padStart(2, '0')}`
    const pastDay = `${prevMonth}-15`
    expect(screen.getByRole('button', { name: pastDay })).toBeDisabled()
  })
})
