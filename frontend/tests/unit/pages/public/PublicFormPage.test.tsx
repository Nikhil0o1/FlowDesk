import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { Route, Routes } from 'react-router-dom'

import { fetchPublicForm, submitPublicForm } from '@/lib/publicForms'
import { renderWithProviders } from '@tests/renderWithProviders'
import PublicFormPage from '@/pages/public/PublicFormPage'

vi.mock('@/lib/publicForms', () => ({
  fetchPublicForm: vi.fn(),
  submitPublicForm: vi.fn(),
  copyPublicFormLink: vi.fn(),
}))

describe('PublicFormPage', () => {
  beforeEach(() => {
    vi.mocked(fetchPublicForm).mockResolvedValue({
      id: 'form-1',
      name: 'Feedback',
      description: 'Tell us what you think',
      is_active: true,
      fields: [
        { id: 'f1', type: 'text', label: 'Name', required: true },
        { id: 'f2', type: 'text', label: 'Notes', required: false },
      ],
      public_token: 'pub-token',
      workspace_name: 'Main Workspace',
    } as Awaited<ReturnType<typeof fetchPublicForm>>)
    vi.mocked(submitPublicForm).mockResolvedValue({ ok: true })
  })

  it('shows loading then renders the form', async () => {
    renderWithProviders(
      <Routes>
        <Route path="/f/:token" element={<PublicFormPage />} />
      </Routes>,
      { routerProps: { initialEntries: ['/f/pub-token'] } },
    )
    expect(await screen.findByRole('heading', { name: 'Feedback' })).toBeInTheDocument()
    expect(screen.getByText('Tell us what you think')).toBeInTheDocument()
  })

  it('validates required fields', async () => {
    const user = userEvent.setup()
    renderWithProviders(
      <Routes>
        <Route path="/f/:token" element={<PublicFormPage />} />
      </Routes>,
      { routerProps: { initialEntries: ['/f/pub-token'] } },
    )
    await screen.findByRole('heading', { name: 'Feedback' })
    await user.click(screen.getByRole('button', { name: 'Submit' }))
    expect(await screen.findByText(/'Name' is required/i)).toBeInTheDocument()
    expect(submitPublicForm).not.toHaveBeenCalled()
  })

  it('submits and allows another response', async () => {
    const user = userEvent.setup()
    renderWithProviders(
      <Routes>
        <Route path="/f/:token" element={<PublicFormPage />} />
      </Routes>,
      { routerProps: { initialEntries: ['/f/pub-token'] } },
    )
    await screen.findByRole('heading', { name: 'Feedback' })
    const [nameInput] = screen.getAllByRole('textbox')
    await user.type(nameInput, 'Alice')
    await user.click(screen.getByRole('button', { name: 'Submit' }))
    expect(await screen.findByText('Thanks! Submission received.')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Submit another response' }))
    expect(screen.getByRole('heading', { name: 'Feedback' })).toBeInTheDocument()
  })

  it('shows unavailable state for missing form', async () => {
    vi.mocked(fetchPublicForm).mockRejectedValue(new Error('Not found'))
    renderWithProviders(
      <Routes>
        <Route path="/f/:token" element={<PublicFormPage />} />
      </Routes>,
      { routerProps: { initialEntries: ['/f/bad-token'] } },
    )
    expect(await screen.findByRole('heading', { name: 'Form unavailable' })).toBeInTheDocument()
  })

  it('shows paused form message when inactive', async () => {
    vi.mocked(fetchPublicForm).mockResolvedValue({
      id: 'form-1',
      name: 'Feedback',
      description: null,
      is_active: false,
      fields: [],
      public_token: 'pub-token',
      workspace_name: 'Main Workspace',
    } as Awaited<ReturnType<typeof fetchPublicForm>>)

    renderWithProviders(
      <Routes>
        <Route path="/f/:token" element={<PublicFormPage />} />
      </Routes>,
      { routerProps: { initialEntries: ['/f/pub-token'] } },
    )
    await waitFor(() => {
      expect(screen.getByText(/paused/i)).toBeInTheDocument()
    })
  })
})
