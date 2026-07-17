import { newBlockId } from './docEditorBlocks'

export function getCodeBlock(node: Element | null): HTMLElement | null {
  if (!node) return null
  const block = (node as HTMLElement).closest?.('.doc-code-block')
  return block instanceof HTMLElement ? block : null
}

export function getCodePre(block: HTMLElement): HTMLPreElement | null {
  const pre = block.querySelector(':scope > pre')
  return pre instanceof HTMLPreElement ? pre : null
}

function escapeHtml(s: string) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

export function createCodeBlockHtml(text = '', id = newBlockId(), minHeight = 96) {
  const body = text.trim() ? escapeHtml(text) : '<br>'
  return (
    `<div class="doc-code-block doc-editor-block" data-block-id="${id}" data-block-type="code" ` +
    `style="min-height:${Math.max(64, minHeight)}px"><pre><code>${body}</code></pre></div><p><br></p>`
  )
}

/** Wrap legacy bare `<pre>` nodes into selectable code blocks. */
export function wrapOrphanPres(root: HTMLElement) {
  root.querySelectorAll('pre').forEach((pre) => {
    if (pre.closest('.doc-code-block')) return
    const block = document.createElement('div')
    block.className = 'doc-code-block doc-editor-block'
    block.setAttribute('data-block-id', newBlockId())
    block.setAttribute('data-block-type', 'code')
    block.style.minHeight = '96px'
    const parent = pre.parentNode
    if (!parent) return
    parent.insertBefore(block, pre)
    block.appendChild(pre)
    if (!pre.querySelector('code')) {
      const code = document.createElement('code')
      while (pre.firstChild) code.appendChild(pre.firstChild)
      pre.appendChild(code)
    }
  })
}

export function placeCaretAfterCodeBlock(block: HTMLElement) {
  let next = block.nextElementSibling
  if (!(next instanceof HTMLElement) || next.tagName !== 'P') {
    const p = document.createElement('p')
    p.innerHTML = '<br>'
    block.insertAdjacentElement('afterend', p)
    next = p
  }
  const range = document.createRange()
  range.setStart(next, 0)
  range.collapse(true)
  const sel = window.getSelection()
  sel?.removeAllRanges()
  sel?.addRange(range)
}

export function setCodeBlockMinHeight(block: HTMLElement, heightPx: number) {
  block.style.minHeight = `${Math.max(64, Math.min(640, Math.round(heightPx)))}px`
}

export function codeBlockPlainText(block: HTMLElement): string {
  const pre = getCodePre(block)
  return (pre?.innerText ?? block.innerText ?? '').replace(/\u00a0/g, ' ').replace(/\n$/, '')
}

export async function copyCodeToClipboard(block: HTMLElement) {
  await navigator.clipboard.writeText(codeBlockPlainText(block))
}

/** True when the caret is at / past the last text in the code block. */
export function isCaretAtEndOfCodeBlock(block: HTMLElement): boolean {
  const sel = window.getSelection()
  if (!sel || sel.rangeCount === 0 || !sel.isCollapsed) return false
  const pre = getCodePre(block)
  if (!pre || !pre.contains(sel.anchorNode)) return false
  const range = sel.getRangeAt(0).cloneRange()
  range.selectNodeContents(pre)
  range.setStart(sel.anchorNode!, sel.anchorOffset)
  return range.toString().replace(/\u200b/g, '').trim().length === 0
}

/** Strip a trailing empty line created by Enter before exiting. */
export function trimTrailingEmptyCodeLine(block: HTMLElement) {
  const code = block.querySelector('code') ?? getCodePre(block)
  if (!code) return
  const html = code.innerHTML
  const trimmed = html
    .replace(/(?:<br\s*\/?>|\n|\r)+$/i, '')
    .replace(/(?:<div><br\s*\/?><\/div>)+$/i, '')
  if (trimmed !== html) code.innerHTML = trimmed || '<br>'
}
