import { describe, expect, it } from 'vitest'

import { detectImportFormat, importFileAsDoc } from '@/modules/docs/services/docExport.service'

describe('detectImportFormat', () => {
  it('maps common extensions', () => {
    expect(detectImportFormat('notes.md')).toBe('markdown')
    expect(detectImportFormat('notes.markdown')).toBe('markdown')
    expect(detectImportFormat('page.html')).toBe('html')
    expect(detectImportFormat('page.htm')).toBe('html')
    expect(detectImportFormat('readme.txt')).toBe('text')
    expect(detectImportFormat('readme.text')).toBe('text')
  })
})

describe('importFileAsDoc', () => {
  it('imports markdown as a titled HTML doc', async () => {
    const file = new File(['# Hello\n\nWorld'], 'spec.md', { type: 'text/markdown' })
    const imported = await importFileAsDoc(file)
    expect(imported.title).toBe('spec')
    expect(imported.format).toBe('markdown')
    expect(imported.content).toContain('<h1>Hello</h1>')
    expect(imported.content).toContain('<p>World</p>')
  })

  it('imports plain text paragraphs', async () => {
    const file = new File(['Line one\n\nLine two'], 'notes.txt', { type: 'text/plain' })
    const imported = await importFileAsDoc(file)
    expect(imported.title).toBe('notes')
    expect(imported.format).toBe('text')
    expect(imported.content).toContain('<p>Line one</p>')
    expect(imported.content).toContain('<p>Line two</p>')
  })

  it('imports html and prefers h1 title', async () => {
    const html = '<!doctype html><html><body><h1>Cover Title</h1><p>Body</p></body></html>'
    const file = new File([html], 'export.html', { type: 'text/html' })
    const imported = await importFileAsDoc(file)
    expect(imported.title).toBe('Cover Title')
    expect(imported.format).toBe('html')
    expect(imported.content).toContain('<p>Body</p>')
    expect(imported.content).not.toContain('<h1>Cover Title</h1>')
  })

  it('rejects unsupported binary types', async () => {
    const file = new File(['PK\u0003\u0004binary'], 'draft.docx')
    await expect(importFileAsDoc(file)).rejects.toThrow(/Unsupported file type/)
  })

  it('falls back to Imported document for empty basenames', async () => {
    const file = new File(['hello'], '.txt', { type: 'text/plain' })
    const imported = await importFileAsDoc(file)
    expect(imported.title).toBe('Imported document')
  })
})
