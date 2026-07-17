import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import { InlineCalendar } from '@/components/ui/InlineCalendar'
import { addDays, toDateKey, todayDateKey } from '@/lib/utils'
import { renderWithProviders } from '@tests/renderWithProviders'

describe('InlineCalendar', () => {
  it('calls onSelect when a day is clicked', async () => {
    const user = userEvent.setup()
    const onSelect = vi.fn()
    renderWithProviders(
      <InlineCalendar value="2026-06-01" min="2026-06-01" max="2026-06-30" onSelect={onSelect} />,
    )

    await user.click(screen.getByRole('button', { name: '2026-06-15' }))
    expect(onSelect).toHaveBeenCalledWith('2026-06-15')
  })

  it('jumps to a month and year via the month picker', async () => {
    const user = userEvent.setup()
    renderWithProviders(
      <InlineCalendar value="2026-06-15" min="2020-01-01" max="2030-12-31" onSelect={vi.fn()} />,
    )

    await user.click(screen.getByRole('button', { name: 'Choose month and year' }))
    await user.click(screen.getByRole('button', { name: 'Next year' }))
    await user.click(screen.getByRole('button', { name: 'Next year' }))
    await user.click(screen.getByRole('button', { name: 'December 2028' }))

    expect(screen.getByText('December 2028')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '2028-12-15' })).toBeInTheDocument()
  })

  it('disables months entirely outside the min/max range', async () => {
    const user = userEvent.setup()
    renderWithProviders(
      <InlineCalendar value="2026-06-15" min="2026-06-01" max="2026-08-31" onSelect={vi.fn()} />,
    )

    await user.click(screen.getByRole('button', { name: 'Choose month and year' }))
    expect(screen.getByRole('button', { name: 'May 2026' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'July 2026' })).toBeEnabled()
    expect(screen.getByRole('button', { name: 'September 2026' })).toBeDisabled()
  })

  it('applies a typed date on Enter', async () => {
    const user = userEvent.setup()
    const onSelect = vi.fn()
    renderWithProviders(
      <InlineCalendar value="2026-06-15" min="2026-06-01" max="2026-12-31" onSelect={onSelect} />,
    )

    const input = screen.getByLabelText('Date')
    await user.clear(input)
    await user.type(input, '2026-08-20{Enter}')
    expect(onSelect).toHaveBeenCalledWith('2026-08-20')
  })

  it('rejects a typed date outside min/max', async () => {
    const user = userEvent.setup()
    const onSelect = vi.fn()
    renderWithProviders(
      <InlineCalendar value="2026-06-15" min="2026-06-01" max="2026-06-30" onSelect={onSelect} />,
    )

    const input = screen.getByLabelText('Date')
    await user.clear(input)
    await user.type(input, '2026-07-20{Enter}')
    expect(onSelect).not.toHaveBeenCalled()
    expect(input).toHaveValue('2026-06-15')
  })

  it('does not reset the visible month when browsing without selecting', async () => {
    const user = userEvent.setup()
    renderWithProviders(
      <InlineCalendar value="2026-06-15" min="2026-06-01" max="2026-12-31" onSelect={vi.fn()} />,
    )

    expect(screen.getByText('June 2026')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Next month' }))
    expect(screen.getByText('July 2026')).toBeInTheDocument()
  })

  it('offers quick presets that select real dates', async () => {
    const user = userEvent.setup()
    const onSelect = vi.fn()
    renderWithProviders(<InlineCalendar value={null} onSelect={onSelect} />)

    await user.click(screen.getByRole('button', { name: 'Today' }))
    expect(onSelect).toHaveBeenCalledWith(todayDateKey())

    await user.click(screen.getByRole('button', { name: 'Tomorrow' }))
    expect(onSelect).toHaveBeenCalledWith(toDateKey(addDays(new Date(), 1)))
  })

  it('hides quick presets that fall outside min/max', () => {
    renderWithProviders(
      <InlineCalendar value="2026-06-15" min="2026-06-01" max="2026-06-30" onSelect={vi.fn()} />,
    )

    expect(screen.queryByRole('button', { name: 'Today' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Next week' })).not.toBeInTheDocument()
  })

  it('calls onClear when clear is clicked', async () => {
    const user = userEvent.setup()
    const onClear = vi.fn()
    renderWithProviders(
      <InlineCalendar value="2026-06-15" onSelect={vi.fn()} onClear={onClear} clearLabel="Clear date" />,
    )

    await user.click(screen.getByRole('button', { name: 'Clear date' }))
    expect(onClear).toHaveBeenCalled()
  })
})
