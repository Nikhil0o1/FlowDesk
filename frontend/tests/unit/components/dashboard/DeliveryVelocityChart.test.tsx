import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { DeliveryVelocityChart } from '../../../../src/components/dashboard/DeliveryVelocityChart'

describe('DeliveryVelocityChart', () => {
  it('renders empty state when there is no trend data', () => {
    render(<DeliveryVelocityChart trend={[]} summary={null} />)
    expect(screen.getByText(/no tasks completed/i)).toBeInTheDocument()
  })

  it('renders chart summary stats from payload', () => {
    render(
      <DeliveryVelocityChart
        trend={[
          { day: '2026-07-01', label: 'Jul 1', completed_count: 3 },
          { day: '2026-07-02', label: 'Jul 2', completed_count: 5 },
        ]}
        summary={{
          total_completed: 8,
          previous_period_total: 4,
          daily_average: 1,
          best_day_label: 'Jul 2',
          best_day_count: 5,
        }}
      />,
    )

    expect(screen.getByText('This week')).toBeInTheDocument()
    expect(screen.getByText('8')).toBeInTheDocument()
    expect(screen.getByText('Daily average')).toBeInTheDocument()
    expect(screen.getByText('Best day')).toBeInTheDocument()
    expect(screen.getByText('5 tasks completed')).toBeInTheDocument()
  })
})
