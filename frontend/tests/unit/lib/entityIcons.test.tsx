import { render } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { ENTITY_ICON_KEYS, EntityIcon } from '@/lib/entityIcons'

describe('EntityIcon', () => {
  it('renders a known lucide icon key', () => {
    const { container } = render(<EntityIcon icon="rocket" />)
    expect(container.querySelector('svg')).toBeInTheDocument()
  })

  it('returns null for empty or unknown keys', () => {
    const { container: empty } = render(<EntityIcon icon={null} />)
    expect(empty.firstChild).toBeNull()

    const { container: unknown } = render(<EntityIcon icon="not-a-real-icon" />)
    expect(unknown.firstChild).toBeNull()
  })

  it('accepts size and className', () => {
    const { container } = render(<EntityIcon icon="folder" size={20} className="text-brand" />)
    const svg = container.querySelector('svg')
    expect(svg).toBeInTheDocument()
    expect(svg).toHaveClass('text-brand')
  })
})

describe('ENTITY_ICON_KEYS', () => {
  it('includes common project and space icons', () => {
    expect(ENTITY_ICON_KEYS).toContain('rocket')
    expect(ENTITY_ICON_KEYS).toContain('folder')
    expect(ENTITY_ICON_KEYS.length).toBeGreaterThan(20)
  })
})
