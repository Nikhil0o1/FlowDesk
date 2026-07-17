import { Check } from 'lucide-react'
import { useEffect, useState } from 'react'

import { errorMessage } from '../../lib/api'
import { saveTemplate, VISIBILITY_LABELS, type TemplateKind, type TemplateVisibility } from '../../lib/templates'
import { cn } from '../../lib/utils'
import { toast } from '../../stores/toast'
import { Modal } from '../ui/Modal'

interface Props {
  open: boolean
  onClose: () => void
  kind: TemplateKind
  source: { id: string; name: string } | null
  onSaved?: () => void
}

const VISIBILITY_ORDER: TemplateVisibility[] = ['workspace', 'admins', 'private']

export function SaveAsTemplateModal({ open, onClose, kind, source, onSaved }: Props) {
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [tagsText, setTagsText] = useState('')
  const [visibility, setVisibility] = useState<TemplateVisibility>('workspace')
  const [includeTasks, setIncludeTasks] = useState(true)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (open && source) {
      setName(`${source.name} Template`)
      setDescription('')
      setTagsText('')
      setVisibility('workspace')
      setIncludeTasks(true)
    }
  }, [open, source?.id])

  const save = async () => {
    if (!source || !name.trim()) return
    setSaving(true)
    try {
      await saveTemplate({
        kind,
        source_id: source.id,
        name: name.trim(),
        description: description.trim() || null,
        tags: tagsText.split(',').map((t) => t.trim()).filter(Boolean),
        visibility,
        include_tasks: includeTasks,
      })
      toast.success('Template saved')
      onSaved?.()
      onClose()
    } catch (err) {
      toast.error(errorMessage(err))
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal open={open} onClose={onClose} title={`Save as new ${kind} template`} width="max-w-lg">
      <div className="space-y-4">
        <div>
          <label className="mb-1 block text-xs font-medium text-fg-secondary">Template name</label>
          <input
            autoFocus
            className="input-dark w-full"
            placeholder="Enter template name…"
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && void save()}
          />
        </div>

        <div>
          <label className="mb-1 block text-xs font-medium text-fg-secondary">Description (optional)</label>
          <textarea
            className="input-dark min-h-[64px] w-full resize-y"
            placeholder="What is this template for?"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
          />
        </div>

        <div>
          <label className="mb-1 block text-xs font-medium text-fg-secondary">Tags (comma-separated)</label>
          <input
            className="input-dark w-full"
            placeholder="e.g. Engineering, Sprint"
            value={tagsText}
            onChange={(e) => setTagsText(e.target.value)}
          />
        </div>

        <div>
          <label className="mb-1.5 block text-xs font-medium text-fg-secondary">Share with</label>
          <div className="space-y-1">
            {VISIBILITY_ORDER.map((v) => (
              <button
                key={v}
                onClick={() => setVisibility(v)}
                className={cn(
                  'flex w-full items-center gap-2 rounded-lg border px-3 py-2 text-left text-sm transition-colors',
                  visibility === v
                    ? 'border-brand bg-brand-soft text-fg'
                    : 'border-ink-700 text-fg-secondary hover:bg-ink-750',
                )}
              >
                <span
                  className={cn(
                    'flex h-4 w-4 items-center justify-center rounded-full border',
                    visibility === v ? 'border-brand bg-brand text-white' : 'border-ink-600',
                  )}
                >
                  {visibility === v && <Check size={11} strokeWidth={3} />}
                </span>
                {VISIBILITY_LABELS[v]}
              </button>
            ))}
          </div>
        </div>

        <label className="flex cursor-pointer items-center gap-2 text-sm text-fg-secondary">
          <input type="checkbox" checked={includeTasks} onChange={(e) => setIncludeTasks(e.target.checked)} />
          Include existing tasks in the template
        </label>

        <div className="flex justify-end gap-2 pt-1">
          <button className="btn-secondary" onClick={onClose} disabled={saving}>
            Cancel
          </button>
          <button className="btn-primary" onClick={() => void save()} disabled={saving || !name.trim()}>
            {saving ? 'Saving…' : 'Save Template'}
          </button>
        </div>
      </div>
    </Modal>
  )
}
