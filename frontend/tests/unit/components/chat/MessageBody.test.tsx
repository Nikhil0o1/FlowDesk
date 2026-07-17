import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'

import { MessageBody } from '@/components/chat/MessageBody'
import { EmojiPicker } from '@/components/chat/EmojiPicker'
import userEvent from '@testing-library/user-event'

const ME = '11111111-1111-1111-1111-111111111111'
const OTHER = '22222222-2222-2222-2222-222222222222'
const TASK = '33333333-3333-3333-3333-333333333333'

function renderBody(body: string) {
  return render(
    <MemoryRouter>
      <MessageBody body={body} currentUserId={ME} />
    </MemoryRouter>,
  )
}

describe('MessageBody', () => {
  it('renders a mention of another user as a soft chip', () => {
    renderBody(`hey @[Jane Doe](${OTHER}) can you look?`)
    const chip = screen.getByText('@Jane Doe')
    expect(chip).toHaveClass('bg-brand-soft')
    expect(screen.getByText(/can you look/)).toBeInTheDocument()
  })

  it('highlights a mention of the current user strongly', () => {
    renderBody(`ping @[Me Myself](${ME})`)
    expect(screen.getByText('@Me Myself')).toHaveClass('bg-brand', 'text-white')
  })

  it('highlights @all for everyone', () => {
    renderBody('heads up @[All](all)')
    expect(screen.getByText('@All')).toHaveClass('bg-brand', 'text-white')
  })

  it('renders task markup as a link showing the task name', () => {
    renderBody(`see #[Fix login redirect](${TASK}) for details`)
    const link = screen.getByRole('link', { name: /Fix login redirect/ })
    expect(link).toHaveAttribute('href', `/app/tasks/${TASK}`)
  })

  it('linkifies bare URLs', () => {
    renderBody('docs at https://example.com/page and more')
    const link = screen.getByRole('link', { name: 'https://example.com/page' })
    expect(link).toHaveAttribute('href', 'https://example.com/page')
    expect(link).toHaveAttribute('target', '_blank')
  })

  it('renders plain text unchanged', () => {
    renderBody('just a plain message')
    expect(screen.getByText('just a plain message')).toBeInTheDocument()
  })
})

describe('EmojiPicker', () => {
  it('searches by name and reports the picked emoji', async () => {
    const user = userEvent.setup()
    const onPick = vi.fn()
    render(<EmojiPicker onPick={onPick} />)

    await user.type(screen.getByLabelText('Search emoji'), 'rocket')
    await user.click(screen.getByRole('button', { name: 'rocket' }))
    expect(onPick).toHaveBeenCalledWith('🚀')
  })
})
