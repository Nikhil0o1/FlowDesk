import { Dropdown } from '../../../components/ui/Dropdown'
import {
  DOC_EXPORT_EXTRA_FORMATS,
  DOC_EXPORT_FORMATS,
  exportDocument,
  type ExportFormat,
} from '../services/docExport.service'
import type { FlowDoc } from '../types/document'

export function DocExportDropdown({
  doc,
  onExported,
  trigger,
  width = 'w-44',
}: {
  doc: Pick<FlowDoc, 'id' | 'title' | 'content'>
  onExported?: (format: ExportFormat) => void
  trigger: React.ReactNode
  width?: string
}) {
  const run = async (format: ExportFormat, close: () => void) => {
    close()
    await exportDocument(doc, format)
    onExported?.(format)
  }

  return (
    <Dropdown align="right" width={width} trigger={trigger}>
      {(close) => (
        <>
          {DOC_EXPORT_FORMATS.map(({ format, label }) => (
            <button key={format} type="button" className="menu-item" onClick={() => void run(format, close)}>
              {label}
            </button>
          ))}
          <div className="my-1 border-t border-ink-700" />
          {DOC_EXPORT_EXTRA_FORMATS.map(({ format, label }) => (
            <button key={format} type="button" className="menu-item" onClick={() => void run(format, close)}>
              {label}
            </button>
          ))}
        </>
      )}
    </Dropdown>
  )
}
