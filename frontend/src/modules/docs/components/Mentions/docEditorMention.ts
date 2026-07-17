export type DocMentionTab = 'people' | 'tasks' | 'docs' | 'whiteboards' | 'locations' | 'channels'

export const DOC_MENTION_TABS: { id: DocMentionTab; label: string }[] = [
  { id: 'people', label: 'People' },
  { id: 'tasks', label: 'Tasks' },
  { id: 'docs', label: 'Docs' },
  { id: 'whiteboards', label: 'Whiteboards' },
  { id: 'locations', label: 'Locations' },
  { id: 'channels', label: 'Channels' },
]

export interface DocMentionTrigger {
  tab: DocMentionTab
  query: string
  /** Full trigger text to replace (e.g. "@@foo"). */
  triggerText: string
}

const TRIGGERS: { re: RegExp; tab: DocMentionTab }[] = [
  { re: /(^|\s)(@@@@)([^\s@]*)$/, tab: 'whiteboards' },
  { re: /(^|\s)(@@@)([^\s@]*)$/, tab: 'docs' },
  { re: /(^|\s)(@@)([^\s@]*)$/, tab: 'tasks' },
  { re: /(^|\s)(@\/)([^\s]*)$/, tab: 'locations' },
  { re: /(^|\s)(@)([^\s@]*)$/, tab: 'people' },
  { re: /(^|\s)(#)([^\s#]*)$/, tab: 'channels' },
]

/** Detect @ / @@ / @@@ / @@@@ / @/ / # mention triggers before the caret. */
export function detectDocMentionTrigger(textBeforeCaret: string): DocMentionTrigger | null {
  for (const { re, tab } of TRIGGERS) {
    const match = re.exec(textBeforeCaret)
    if (!match) continue
    const prefix = match[1] ?? ''
    const sigil = match[2] ?? ''
    const query = match[3] ?? ''
    return { tab, query, triggerText: `${prefix}${sigil}${query}`.slice(prefix.length) }
  }
  return null
}

/** Plain text from editor start through the caret. */
export function getTextBeforeCaret(editor: HTMLElement): string {
  const sel = window.getSelection()
  if (!sel || sel.rangeCount === 0) return ''
  const range = sel.getRangeAt(0)
  if (!editor.contains(range.endContainer)) return ''
  const pre = range.cloneRange()
  pre.selectNodeContents(editor)
  pre.setEnd(range.endContainer, range.endOffset)
  return pre.toString()
}

/** Delete `charCount` characters before the caret, then insert HTML. */
export function replaceBeforeCaret(editor: HTMLElement, charCount: number, html: string) {
  editor.focus()
  const sel = window.getSelection()
  if (!sel || sel.rangeCount === 0) return
  const range = sel.getRangeAt(0)
  if (!editor.contains(range.endContainer)) return

  for (let i = 0; i < charCount; i++) {
    document.execCommand('delete', false, 'backward')
  }
  document.execCommand('insertHTML', false, html)
}

export function mentionChipHtml(
  tab: DocMentionTab,
  id: string,
  label: string,
  href?: string,
): string {
  const safeLabel =
    tab === 'people' && id === 'all'
      ? '@All'
      : label.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  const safeId = id.replace(/"/g, '&quot;')
  const chipClass =
    tab === 'people' && id === 'all'
      ? 'doc-mention doc-mention-people doc-mention-all'
      : `doc-mention doc-mention-${tab}`
  if (href) {
    return `<a href="${href}" class="${chipClass}" data-mention-type="${tab}" data-mention-id="${safeId}" contenteditable="false">${safeLabel}</a>&nbsp;`
  }
  return `<span class="${chipClass}" data-mention-type="${tab}" data-mention-id="${safeId}" contenteditable="false">${safeLabel}</span>&nbsp;`
}
