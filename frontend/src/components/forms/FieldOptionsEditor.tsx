import { Plus, Trash2 } from 'lucide-react'
import { useState } from 'react'

function parseBulk(raw: string): string[] {
  return raw
    .split(/[,\n]/)
    .map((o) => o.trim())
    .filter(Boolean)
}

/** Edit a list of select/checklist options with per-row add/delete and bulk paste. */
export function FieldOptionsEditor({
  options,
  onChange,
}: {
  options: string[]
  onChange: (options: string[]) => void
}) {
  const [drafts, setDrafts] = useState<string[]>(() => (options.length > 0 ? [...options] : ['']))
  const [bulk, setBulk] = useState('')

  const persist = (rows: string[]) => {
    onChange(rows.map((o) => o.trim()).filter(Boolean))
  }

  const updateDraft = (index: number, value: string) => {
    const next = drafts.map((d, i) => (i === index ? value : d))
    setDrafts(next)
    persist(next)
  }

  const addRow = () => setDrafts([...drafts, ''])

  const removeRow = (index: number) => {
    const next = drafts.filter((_, i) => i !== index)
    const rows = next.length > 0 ? next : ['']
    setDrafts(rows)
    persist(rows)
  }

  const applyBulk = () => {
    const parsed = parseBulk(bulk)
    if (parsed.length === 0) return
    const existing = drafts.map((o) => o.trim()).filter(Boolean)
    const merged = [...existing]
    for (const opt of parsed) {
      if (!merged.includes(opt)) merged.push(opt)
    }
    setBulk('')
    setDrafts(merged)
    persist(merged)
  }

  return (
    <div className="mt-2 space-y-2">
      <p className="text-[11px] text-fg-muted">Options</p>
      <div className="space-y-1.5">
        {drafts.map((draft, index) => (
          <div key={index} className="flex items-center gap-1.5">
            <input
              className="min-w-0 flex-1 rounded-lg border border-ink-700 bg-ink-800 px-2.5 py-1.5 text-xs text-fg outline-none focus:border-brand"
              placeholder={`Option ${index + 1}`}
              value={draft}
              onChange={(e) => updateDraft(index, e.target.value)}
            />
            <button
              type="button"
              className="btn-ghost !p-1 hover:!text-red-400"
              title="Remove option"
              disabled={drafts.length <= 1}
              onClick={() => removeRow(index)}
            >
              <Trash2 size={12} />
            </button>
          </div>
        ))}
      </div>
      <button type="button" className="btn-ghost !px-1.5 !py-1 text-[11px] text-fg-secondary" onClick={addRow}>
        <Plus size={11} /> Add option
      </button>
      <div className="flex items-start gap-1.5">
        <input
          className="min-w-0 flex-1 rounded-lg border border-ink-700 bg-ink-800 px-2.5 py-1.5 text-xs text-fg outline-none focus:border-brand"
          placeholder="Paste options (comma or newline separated)"
          value={bulk}
          onChange={(e) => setBulk(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault()
              applyBulk()
            }
          }}
        />
        <button
          type="button"
          className="btn-secondary shrink-0 !py-1.5 text-[11px]"
          disabled={!bulk.trim()}
          onClick={applyBulk}
        >
          Add
        </button>
      </div>
    </div>
  )
}
