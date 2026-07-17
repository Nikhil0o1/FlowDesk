import type { FlowDoc } from '../types/document'
import { exportDocumentApi } from './docsApi.service'

export type ExportFormat = 'pdf' | 'docx' | 'text' | 'html' | 'markdown'

export const DOC_EXPORT_FORMATS: { format: ExportFormat; label: string }[] = [
  { format: 'pdf', label: 'PDF (.pdf)' },
  { format: 'docx', label: 'Word (.docx)' },
  { format: 'text', label: 'Plain text (.txt)' },
]

export const DOC_EXPORT_EXTRA_FORMATS: { format: ExportFormat; label: string }[] = [
  { format: 'html', label: 'HTML (.html)' },
  { format: 'markdown', label: 'Markdown (.md)' },
]

function sanitizeFilename(name: string): string {
  return (name || 'document').replace(/[^\w\-. ]+/g, '').trim().slice(0, 80) || 'document'
}

function download(filename: string, content: string | Blob, mime?: string) {
  const blob = content instanceof Blob ? content : new Blob([content], { type: mime })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)
}

/** Rough HTML → plain text: strip tags but keep block breaks. */
function htmlToText(html: string): string {
  const el = document.createElement('div')
  el.innerHTML = html
  return (el.textContent ?? '').replace(/\n{3,}/g, '\n\n').trim()
}

/** Minimal HTML → Markdown conversion covering the editor's common blocks. */
function htmlToMarkdown(html: string): string {
  const el = document.createElement('div')
  el.innerHTML = html

  const walk = (node: Node): string => {
    if (node.nodeType === Node.TEXT_NODE) return node.textContent ?? ''
    if (node.nodeType !== Node.ELEMENT_NODE) return ''
    const e = node as HTMLElement
    const inner = Array.from(e.childNodes).map(walk).join('')
    switch (e.tagName) {
      case 'H1':
        return `# ${inner}\n\n`
      case 'H2':
        return `## ${inner}\n\n`
      case 'H3':
        return `### ${inner}\n\n`
      case 'STRONG':
      case 'B':
        return `**${inner}**`
      case 'EM':
      case 'I':
        return `*${inner}*`
      case 'CODE':
        return `\`${inner}\``
      case 'A':
        return `[${inner}](${e.getAttribute('href') ?? ''})`
      case 'LI':
        return `- ${inner}\n`
      case 'UL':
      case 'OL':
        return `${inner}\n`
      case 'BLOCKQUOTE':
        return `> ${inner}\n\n`
      case 'BR':
        return '\n'
      case 'P':
      case 'DIV':
        return `${inner}\n\n`
      default:
        return inner
    }
  }

  return walk(el).replace(/\n{3,}/g, '\n\n').trim()
}

function exportDocumentLocal(doc: Pick<FlowDoc, 'title' | 'content'>, format: 'html' | 'markdown' | 'text') {
  const base = sanitizeFilename(doc.title)
  const title = doc.title || 'Untitled'
  if (format === 'html') {
    const html = `<!doctype html><html><head><meta charset="utf-8"><title>${title}</title></head><body><h1>${title}</h1>${doc.content}</body></html>`
    download(`${base}.html`, html, 'text/html')
  } else if (format === 'markdown') {
    download(`${base}.md`, `# ${title}\n\n${htmlToMarkdown(doc.content)}\n`, 'text/markdown')
  } else {
    download(`${base}.txt`, `${title}\n\n${htmlToText(doc.content)}\n`, 'text/plain')
  }
}

/** Export a document to a downloaded file in the requested format. */
export async function exportDocument(
  doc: Pick<FlowDoc, 'id' | 'title' | 'content'>,
  format: ExportFormat,
) {
  if (format === 'pdf' || format === 'docx') {
    if (!doc.id) throw new Error('Save the document before exporting to PDF or Word')
    const blob = await exportDocumentApi(doc.id, format)
    const ext = format === 'pdf' ? 'pdf' : 'docx'
    download(`${sanitizeFilename(doc.title)}.${ext}`, blob)
    return
  }

  if (format === 'text' && doc.id) {
    const blob = await exportDocumentApi(doc.id, 'text')
    download(`${sanitizeFilename(doc.title)}.txt`, blob)
    return
  }

  exportDocumentLocal(doc, format)
}

/** Very small Markdown → HTML for imported .md files (headings, bold, italic, lists). */
function markdownToHtml(md: string): string {
  const lines = md.split(/\r?\n/)
  const out: string[] = []
  let inList = false
  const closeList = () => {
    if (inList) {
      out.push('</ul>')
      inList = false
    }
  }
  const inline = (s: string) =>
    s
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
      .replace(/\*(.+?)\*/g, '<em>$1</em>')
      .replace(/`(.+?)`/g, '<code>$1</code>')

  for (const raw of lines) {
    const line = raw.trimEnd()
    if (/^#{3}\s+/.test(line)) {
      closeList()
      out.push(`<h3>${inline(line.replace(/^#{3}\s+/, ''))}</h3>`)
    } else if (/^#{2}\s+/.test(line)) {
      closeList()
      out.push(`<h2>${inline(line.replace(/^#{2}\s+/, ''))}</h2>`)
    } else if (/^#\s+/.test(line)) {
      closeList()
      out.push(`<h1>${inline(line.replace(/^#\s+/, ''))}</h1>`)
    } else if (/^[-*]\s+/.test(line)) {
      if (!inList) {
        out.push('<ul>')
        inList = true
      }
      out.push(`<li>${inline(line.replace(/^[-*]\s+/, ''))}</li>`)
    } else if (line === '') {
      closeList()
    } else {
      closeList()
      out.push(`<p>${inline(line)}</p>`)
    }
  }
  closeList()
  return out.join('')
}

export type ImportFormat = 'html' | 'markdown' | 'text'

export interface ImportedDoc {
  title: string
  content: string
  format: ImportFormat
}

const IMPORT_EXT_RE = /\.(html?|md|markdown|txt|text)$/i
const UNSUPPORTED_IMPORT_EXT_RE = /\.(docx?|pdf|rtf|odt|xlsx?|pptx?|zip|png|jpe?g|gif|webp)$/i

export function detectImportFormat(filename: string): ImportFormat {
  const lower = filename.toLowerCase()
  if (lower.endsWith('.md') || lower.endsWith('.markdown')) return 'markdown'
  if (lower.endsWith('.html') || lower.endsWith('.htm')) return 'html'
  return 'text'
}

function titleFromFilename(filename: string): string {
  const base = filename.replace(/\.[^.]+$/, '').trim()
  return base || 'Imported document'
}

/** Parse an exported / pasted HTML file into a doc title + body HTML. */
function htmlFileToDoc(text: string, fallbackTitle: string): ImportedDoc {
  let root: HTMLElement | null = null
  try {
    const parsed = new DOMParser().parseFromString(text, 'text/html')
    root = parsed.body
  } catch {
    root = null
  }
  if (!root) {
    const el = document.createElement('div')
    el.innerHTML = text
    root = el
  }
  const h1 = root.querySelector('h1')
  const title = h1?.textContent?.trim() || fallbackTitle
  if (h1) h1.remove()
  const content = root.innerHTML.trim() || `<p></p>`
  return { title: title || 'Imported document', content, format: 'html' }
}

function plainTextToHtml(text: string): string {
  const normalized = text.replace(/\r\n/g, '\n').trim()
  if (!normalized) return '<p></p>'
  return normalized
    .split(/\n{2,}/)
    .map((p) => {
      const safe = p
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/\n/g, '<br>')
      return `<p>${safe}</p>`
    })
    .join('')
}

/** Read file contents as UTF-8 text (works in browsers and jsdom). */
async function readFileText(file: File): Promise<string> {
  if (typeof file.arrayBuffer === 'function') {
    const buf = await file.arrayBuffer()
    return new TextDecoder('utf-8', { fatal: false }).decode(buf)
  }
  if (typeof file.text === 'function') {
    return file.text()
  }
  return await new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result ?? ''))
    reader.onerror = () => reject(new Error('Could not read that file'))
    reader.readAsText(file)
  })
}

/** Read a user-selected file into { title, content } suitable for a Flowdesk Doc. */
export async function importFileAsDoc(file: File): Promise<ImportedDoc> {
  const filename = file.name || 'document.txt'
  const lower = filename.toLowerCase()

  if (UNSUPPORTED_IMPORT_EXT_RE.test(lower)) {
    throw new Error('Unsupported file type. Import HTML, Markdown, or plain text (.html, .md, .txt).')
  }
  if (!IMPORT_EXT_RE.test(lower) && file.type && !/^(text\/|application\/(json|xml))/i.test(file.type)) {
    throw new Error('Unsupported file type. Import HTML, Markdown, or plain text (.html, .md, .txt).')
  }

  let text: string
  try {
    text = await readFileText(file)
  } catch {
    throw new Error('Could not read that file')
  }

  // Binary files sometimes slip through as "text"; reject obvious ZIP/PDF signatures.
  if (text.startsWith('PK\u0003\u0004') || text.startsWith('%PDF')) {
    throw new Error('Unsupported file type. Import HTML, Markdown, or plain text (.html, .md, .txt).')
  }

  const fallbackTitle = titleFromFilename(filename)
  const format = detectImportFormat(filename)

  if (format === 'html') {
    return htmlFileToDoc(text, fallbackTitle)
  }
  if (format === 'markdown') {
    return {
      title: fallbackTitle,
      content: markdownToHtml(text) || '<p></p>',
      format,
    }
  }
  return {
    title: fallbackTitle,
    content: plainTextToHtml(text),
    format,
  }
}
