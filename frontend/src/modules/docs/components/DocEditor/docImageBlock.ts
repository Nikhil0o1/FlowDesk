import {
  duplicateEditorBlock,
  newBlockId,
} from './docEditorBlocks'

export function getImageBlock(node: Element | null): HTMLElement | null {
  if (!node) return null
  const block = (node as HTMLElement).closest?.('.doc-image-block')
  return block instanceof HTMLElement ? block : null
}

export function getImageFromBlock(block: HTMLElement): HTMLImageElement | null {
  const img = block.querySelector('img')
  return img instanceof HTMLImageElement ? img : null
}

export function createImageBlockHtml(src: string, alt: string, id = newBlockId()) {
  const safeAlt = alt.replace(/"/g, '&quot;')
  return `<div class="doc-image-block doc-editor-block" data-block-id="${id}" data-block-type="image"><img src="${src}" alt="${safeAlt}" /></div><p><br></p>`
}

/** Wrap bare images inserted before block chrome existed. */
export function wrapOrphanImages(root: HTMLElement) {
  root.querySelectorAll('img').forEach((img) => {
    if (img.closest('.doc-image-block')) return
    const block = document.createElement('div')
    block.className = 'doc-image-block doc-editor-block'
    block.setAttribute('data-block-id', newBlockId())
    block.setAttribute('data-block-type', 'image')
    const parent = img.parentNode
    if (!parent) return
    parent.insertBefore(block, img)
    block.appendChild(img)
  })
}

export async function copyImageToClipboard(block: HTMLElement) {
  const img = getImageFromBlock(block)
  if (!img?.src) return
  try {
    const res = await fetch(img.src)
    const blob = await res.blob()
    await navigator.clipboard.write([new ClipboardItem({ [blob.type]: blob })])
  } catch {
    await navigator.clipboard.writeText(img.src)
  }
}

export { duplicateEditorBlock as duplicateImageBlock }
