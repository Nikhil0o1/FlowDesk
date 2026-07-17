import { describe, expect, it } from 'vitest'

import { escapeHtmlAttr } from '@/lib/htmlEscape'

describe('escapeHtmlAttr', () => {
  it('escapes characters that break HTML attributes', () => {
    expect(escapeHtmlAttr('Task "A" & <script>')).toBe(
      'Task &quot;A&quot; &amp; &lt;script&gt;',
    )
  })
})
