import { screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Route, Routes } from 'react-router-dom'

import { renderWithProviders } from '@tests/renderWithProviders'
import PublicTaskPage from '@/pages/public/PublicTaskPage'

describe('PublicTaskPage', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn())
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('renders shared task details', async () => {
    vi.mocked(fetch).mockResolvedValue(
      new Response(
        JSON.stringify({
          title: 'Fix bug',
          ref: 'ALPHA-1',
          description: 'Details here',
          task_type: 'task',
          priority: 'high',
          due_date: '2024-12-01',
          status: { name: 'Open', color: '#2B88EE' },
          assignees: [{ full_name: 'Jane Doe', email: 'jane@example.com', avatar_url: null }],
          checklists: [
            {
              id: 'cl-1',
              name: 'QA',
              items: [{ id: 'i-1', content: 'Run tests', is_done: true }],
            },
          ],
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    )

    renderWithProviders(
      <Routes>
        <Route path="/t/:token" element={<PublicTaskPage />} />
      </Routes>,
      { routerProps: { initialEntries: ['/t/share-token'] } },
    )

    expect(await screen.findByRole('heading', { name: 'Fix bug' })).toBeInTheDocument()
    expect(screen.getByText('ALPHA-1')).toBeInTheDocument()
    expect(screen.getByText('Details here')).toBeInTheDocument()
    expect(screen.getByText('Run tests')).toBeInTheDocument()
  })

  it('shows unavailable message on error', async () => {
    vi.mocked(fetch).mockResolvedValue(new Response('', { status: 404 }))

    renderWithProviders(
      <Routes>
        <Route path="/t/:token" element={<PublicTaskPage />} />
      </Routes>,
      { routerProps: { initialEntries: ['/t/bad-token'] } },
    )

    expect(
      await screen.findByText(/isn't available/i),
    ).toBeInTheDocument()
  })
})
