export type DocBlockType = 'table' | 'image' | 'code'

export function newBlockId(): string {
  return typeof crypto !== 'undefined' && crypto.randomUUID
    ? crypto.randomUUID()
    : `blk-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

export function getEditorBlock(node: Element | null): HTMLElement | null {
  if (!node) return null
  const block = (node as HTMLElement).closest?.('.doc-editor-block')
  return block instanceof HTMLElement ? block : null
}

export function getBlockType(block: HTMLElement): DocBlockType | null {
  const type = block.getAttribute('data-block-type')
  if (type === 'table' || type === 'image' || type === 'code') return type
  if (block.classList.contains('doc-table-block')) return 'table'
  if (block.classList.contains('doc-image-block')) return 'image'
  if (block.classList.contains('doc-code-block')) return 'code'
  return null
}

export function ensureBlockId(block: HTMLElement): string {
  const existing = block.getAttribute('data-block-id') ?? block.getAttribute('data-table-id')
  if (existing) {
    block.setAttribute('data-block-id', existing)
    return existing
  }
  const id = newBlockId()
  block.setAttribute('data-block-id', id)
  return id
}

export function duplicateEditorBlock(block: HTMLElement): HTMLElement {
  const clone = block.cloneNode(true) as HTMLElement
  const id = newBlockId()
  clone.setAttribute('data-block-id', id)
  clone.removeAttribute('data-table-id')
  block.insertAdjacentElement('afterend', clone)
  return clone
}

export function deleteEditorBlock(block: HTMLElement) {
  block.remove()
}

export async function copyBlockLink(block: HTMLElement, docId: string) {
  const id = ensureBlockId(block)
  const url = `${window.location.origin}/app/docs/${docId}#block-${id}`
  await navigator.clipboard.writeText(url)
}
