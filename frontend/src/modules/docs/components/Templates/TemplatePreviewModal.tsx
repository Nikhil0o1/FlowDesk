import { Plus } from 'lucide-react'

import { Modal } from '../../../../components/ui/Modal'
import type { DocTemplate } from '../../types/template'

/** Read-only preview of a template's content with a "Use template" CTA. */
export function TemplatePreviewModal({
  template,
  onClose,
  onUse,
}: {
  template: DocTemplate | null
  onClose: () => void
  onUse: (template: DocTemplate) => void
}) {
  return (
    <Modal open={!!template} onClose={onClose} title={template?.name ?? 'Template'} width="max-w-2xl">
      {template && (
        <div className="space-y-4">
          <p className="text-sm text-fg-secondary">{template.description}</p>
          <div className="max-h-[50vh] overflow-y-auto rounded-xl border border-ink-700 bg-ink-900 p-5">
            <div className="docs-content" dangerouslySetInnerHTML={{ __html: template.content }} />
          </div>
          <div className="flex justify-end gap-2">
            <button className="btn-secondary" onClick={onClose}>
              Close
            </button>
            <button className="btn-primary" onClick={() => onUse(template)}>
              <Plus size={16} /> Use template
            </button>
          </div>
        </div>
      )}
    </Modal>
  )
}
