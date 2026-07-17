import { duplicateEditorBlock, newBlockId } from './docEditorBlocks'

const DEFAULT_COLS = 3
const DEFAULT_ROWS = 2

export function newTableId(): string {
  return newBlockId()
}

export function getTableAtNode(node: Element | null): HTMLTableElement | null {
  if (!node) return null
  const table = (node as HTMLElement).closest?.('table')
  return table instanceof HTMLTableElement ? table : null
}

export function getTableBlock(node: Element | null): HTMLElement | null {
  const table = getTableAtNode(node)
  if (!table) return null
  const parent = table.parentElement
  if (parent?.classList.contains('doc-table-block')) return parent
  return null
}

export function getTableFromBlock(block: HTMLElement): HTMLTableElement | null {
  const table = block.querySelector(':scope > table.doc-table, :scope > table')
  return table instanceof HTMLTableElement ? table : null
}

/** Split blocks that accidentally contain multiple tables into one block each. */
export function normalizeTableBlocks(root: HTMLElement) {
  Array.from(root.querySelectorAll('.doc-table-block')).forEach((block) => {
    const tables = Array.from(block.children).filter(
      (child): child is HTMLTableElement => child instanceof HTMLTableElement,
    )
    if (tables.length <= 1) return
    for (let i = 1; i < tables.length; i++) {
      const table = tables[i]
      const newBlock = document.createElement('div')
      const id = newTableId()
      newBlock.className = 'doc-table-block doc-editor-block'
      newBlock.setAttribute('data-block-id', id)
      newBlock.setAttribute('data-block-type', 'table')
      newBlock.setAttribute('data-table-id', id)
      block.insertAdjacentElement('afterend', newBlock)
      newBlock.appendChild(table)
    }
  })
}

function colWidthPct(cols: number) {
  const w = (100 / cols).toFixed(2)
  return Array.from({ length: cols }, (_, i) =>
    i === cols - 1 ? `${(100 - parseFloat(w) * (cols - 1)).toFixed(2)}%` : `${w}%`,
  )
}

function cellHtml(tag: 'th' | 'td') {
  return `<${tag}><br></${tag}>`
}

function rowHtml(cols: number, tag: 'th' | 'td') {
  return `<tr>${Array.from({ length: cols }, () => cellHtml(tag)).join('')}</tr>`
}

export function createTableBlockHtml(cols = DEFAULT_COLS, rows = DEFAULT_ROWS, id = newTableId()) {
  const widths = colWidthPct(cols)
  const colgroup = `<colgroup>${widths.map((w) => `<col style="width:${w}">`).join('')}</colgroup>`
  const header = rowHtml(cols, 'th')
  const body = Array.from({ length: rows }, () => rowHtml(cols, 'td')).join('')
  return `<div class="doc-table-block doc-editor-block" data-block-id="${id}" data-block-type="table" data-table-id="${id}"><table class="doc-table">${colgroup}<tbody>${header}${body}</tbody></table></div><p><br></p>`
}

/** Wrap legacy bare tables inserted before the block chrome existed. */
export function wrapOrphanTables(root: HTMLElement) {
  root.querySelectorAll('table').forEach((table) => {
    if (table.closest('.doc-table-block')) return
    const block = document.createElement('div')
    block.className = 'doc-table-block doc-editor-block'
    block.setAttribute('data-block-id', newTableId())
    block.setAttribute('data-block-type', 'table')
    block.setAttribute('data-table-id', block.getAttribute('data-block-id')!)
    table.classList.add('doc-table')
    ensureColgroup(table as HTMLTableElement)
    const parent = table.parentNode
    if (!parent) return
    parent.insertBefore(block, table)
    block.appendChild(table)
  })
  normalizeTableBlocks(root)
}

export function ensureColgroup(table: HTMLTableElement) {
  if (table.querySelector('colgroup')) return
  const cols = table.rows[0]?.cells.length ?? DEFAULT_COLS
  const colgroup = document.createElement('colgroup')
  colWidthPct(cols).forEach((w) => {
    const col = document.createElement('col')
    col.style.width = w
    colgroup.appendChild(col)
  })
  table.insertBefore(colgroup, table.firstChild)
}

export function getColElements(table: HTMLTableElement): HTMLTableColElement[] {
  ensureColgroup(table)
  return Array.from(table.querySelectorAll('colgroup col'))
}

export function resizeColumn(table: HTMLTableElement, colIndex: number, deltaPx: number) {
  const cols = getColElements(table)
  const tableWidth = table.getBoundingClientRect().width || 1
  const target = cols[colIndex]
  const next = cols[colIndex + 1]
  if (!target || !next) return
  const targetPct = parseFloat(target.style.width) || 100 / cols.length
  const nextPct = parseFloat(next.style.width) || 100 / cols.length
  const deltaPct = (deltaPx / tableWidth) * 100
  const min = 8
  const newTarget = Math.max(min, Math.min(targetPct + nextPct - min, targetPct + deltaPct))
  const newNext = targetPct + nextPct - newTarget
  target.style.width = `${newTarget}%`
  next.style.width = `${newNext}%`
}

export function duplicateBlock(block: HTMLElement): HTMLElement {
  return duplicateEditorBlock(block)
}

export function deleteBlock(block: HTMLElement) {
  block.remove()
}

export { copyBlockLink } from './docEditorBlocks'

export async function copyTableToClipboard(block: HTMLElement) {
  const table = getTableFromBlock(block)
  if (!table) return
  const rows = Array.from(table.rows).map((row) =>
    Array.from(row.cells)
      .map((c) => c.textContent?.replace(/\s+/g, ' ').trim() ?? '')
      .join('\t'),
  )
  const tsv = rows.join('\n')
  const html = table.outerHTML
  try {
    await navigator.clipboard.write([
      new ClipboardItem({
        'text/plain': new Blob([tsv], { type: 'text/plain' }),
        'text/html': new Blob([html], { type: 'text/html' }),
      }),
    ])
  } catch {
    await navigator.clipboard.writeText(tsv)
  }
}

export function getFocusedCell(table: HTMLTableElement): HTMLTableCellElement | null {
  const sel = window.getSelection()
  if (!sel || sel.rangeCount === 0) return null
  let node: Node | null = sel.anchorNode
  while (node && node !== table) {
    if (node instanceof HTMLTableCellElement) return node
    node = node.parentNode
  }
  return null
}

export function addRow(block: HTMLElement, afterIndex?: number) {
  const table = getTableFromBlock(block)
  if (!table || table.rows.length === 0) return
  const cols = table.rows[0].cells.length
  const tr = document.createElement('tr')
  for (let i = 0; i < cols; i++) {
    const td = document.createElement('td')
    td.innerHTML = '<br>'
    tr.appendChild(td)
  }
  const idx = afterIndex ?? table.rows.length - 1
  const ref = table.rows[idx]
  ref?.insertAdjacentElement('afterend', tr)
}

export function addColumn(block: HTMLElement, afterIndex?: number) {
  const table = getTableFromBlock(block)
  if (!table) return
  const cols = getColElements(table)
  const idx = afterIndex ?? cols.length - 1
  const col = document.createElement('col')
  col.style.width = `${(100 / (cols.length + 1)).toFixed(2)}%`
  cols[idx]?.insertAdjacentElement('afterend', col)
  Array.from(table.rows).forEach((row, rowIndex) => {
    const cell = document.createElement(rowIndex === 0 ? 'th' : 'td')
    cell.innerHTML = rowIndex === 0 ? 'Header' : '<br>'
    row.cells[idx]?.insertAdjacentElement('afterend', cell)
  })
  // Rebalance widths evenly
  const nextCols = getColElements(table)
  const w = `${(100 / nextCols.length).toFixed(2)}%`
  nextCols.forEach((c, i) => {
    c.style.width = i === nextCols.length - 1 ? `${(100 - parseFloat(w) * (nextCols.length - 1)).toFixed(2)}%` : w
  })
}
