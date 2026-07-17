import type { PresenceUserRow } from './types'
import { formatDateTime } from './utils'

export type ExportFormat = 'csv' | 'excel' | 'pdf'

const COLUMNS: { header: string; value: (r: PresenceUserRow) => string }[] = [
  { header: 'Name', value: (r) => r.user.full_name || '' },
  { header: 'Email', value: (r) => r.user.email },
  { header: 'Role', value: (r) => r.role || '' },
  { header: 'Status', value: (r) => r.status },
  { header: 'Workspaces', value: (r) => r.workspaces.join('; ') },
  { header: 'Teams', value: (r) => r.teams.join('; ') },
  { header: 'Login Time', value: (r) => (r.login_time ? formatDateTime(r.login_time) : '') },
  { header: 'Last Seen', value: (r) => (r.last_seen ? formatDateTime(r.last_seen) : '') },
  { header: 'Session Duration', value: (r) => secondsLabel(r.session_duration) },
  { header: 'Idle Time', value: (r) => secondsLabel(r.idle_time) },
  { header: 'Device', value: (r) => r.device || '' },
  { header: 'Browser', value: (r) => r.browser || '' },
]

function secondsLabel(seconds: number | null): string {
  if (seconds == null) return ''
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  if (h > 0) return `${h}h ${m}m`
  if (m > 0) return `${m}m`
  return `${seconds}s`
}

function download(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}

function csvCell(value: string): string {
  if (/[",\n]/.test(value)) return `"${value.replace(/"/g, '""')}"`
  return value
}

function toCsv(rows: PresenceUserRow[]): string {
  const header = COLUMNS.map((c) => csvCell(c.header)).join(',')
  const body = rows.map((r) => COLUMNS.map((c) => csvCell(c.value(r))).join(',')).join('\n')
  return `${header}\n${body}`
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}

/** Excel opens an HTML table saved as .xls — avoids a heavyweight xlsx dependency. */
function toExcelHtml(rows: PresenceUserRow[]): string {
  const head = COLUMNS.map((c) => `<th>${escapeHtml(c.header)}</th>`).join('')
  const body = rows
    .map(
      (r) =>
        `<tr>${COLUMNS.map((c) => `<td>${escapeHtml(c.value(r))}</td>`).join('')}</tr>`,
    )
    .join('')
  return `<html xmlns:x="urn:schemas-microsoft-com:office:excel"><head><meta charset="utf-8"></head><body><table border="1"><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table></body></html>`
}

async function toPdf(rows: PresenceUserRow[], title: string): Promise<void> {
  const { jsPDF } = await import('jspdf')
  const doc = new jsPDF({ orientation: 'landscape', unit: 'pt', format: 'a4' })
  const marginX = 32
  let y = 40

  doc.setFontSize(14)
  doc.text(title, marginX, y)
  y += 8
  doc.setFontSize(8)
  doc.setTextColor(120)
  doc.text(`Generated ${new Date().toLocaleString()}`, marginX, (y += 12))
  doc.setTextColor(20)
  y += 12

  // Compact subset of columns so the table fits an A4 landscape page.
  const pdfCols = COLUMNS.filter((c) =>
    ['Name', 'Email', 'Role', 'Status', 'Login Time', 'Last Seen', 'Session Duration', 'Device'].includes(
      c.header,
    ),
  )
  const pageWidth = doc.internal.pageSize.getWidth()
  const colWidth = (pageWidth - marginX * 2) / pdfCols.length
  const lineHeight = 16

  const drawHeader = () => {
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(8)
    pdfCols.forEach((c, i) => doc.text(c.header, marginX + i * colWidth, y))
    y += 6
    doc.setDrawColor(200)
    doc.line(marginX, y, pageWidth - marginX, y)
    y += lineHeight - 6
    doc.setFont('helvetica', 'normal')
  }

  drawHeader()
  const pageHeight = doc.internal.pageSize.getHeight()
  for (const r of rows) {
    if (y > pageHeight - 40) {
      doc.addPage()
      y = 40
      drawHeader()
    }
    pdfCols.forEach((c, i) => {
      const text = c.value(r)
      const truncated = text.length > 28 ? `${text.slice(0, 27)}…` : text
      doc.text(truncated, marginX + i * colWidth, y)
    })
    y += lineHeight
  }

  doc.save(`${title}.pdf`)
}

export async function exportPresence(
  rows: PresenceUserRow[],
  format: ExportFormat,
  baseName = 'employee-presence',
): Promise<void> {
  const stamp = new Date().toISOString().slice(0, 10)
  const filename = `${baseName}-${stamp}`
  if (format === 'csv') {
    download(new Blob(['\ufeff', toCsv(rows)], { type: 'text/csv;charset=utf-8;' }), `${filename}.csv`)
  } else if (format === 'excel') {
    download(
      new Blob([toExcelHtml(rows)], { type: 'application/vnd.ms-excel;charset=utf-8;' }),
      `${filename}.xls`,
    )
  } else {
    await toPdf(rows, filename)
  }
}
