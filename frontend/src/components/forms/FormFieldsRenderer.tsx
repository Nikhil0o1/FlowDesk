import type { FormField } from '../../lib/types'
import { cn } from '../../lib/utils'

/** Checklist answers are stored as newline-separated option labels. */
export function parseChecklistValue(raw: string | undefined): string[] {
  if (!raw?.trim()) return []
  return raw.split('\n').map((s) => s.trim()).filter(Boolean)
}

export function serializeChecklistValue(selected: string[]): string {
  return selected.join('\n')
}

export function FormFieldsRenderer({
  fields,
  values,
  onChange,
  light,
}: {
  fields: FormField[]
  values: Record<string, string>
  onChange: (id: string, value: string) => void
  light?: boolean
}) {
  const inputCls = light
    ? 'w-full rounded-lg border border-gray-300 bg-white px-3.5 py-2.5 text-sm text-gray-900 outline-none placeholder:text-gray-400 focus:border-brand focus:ring-2 focus:ring-brand/20'
    : 'input-dark'
  const labelCls = light
    ? 'mb-1.5 block text-sm font-medium text-gray-800'
    : 'mb-1.5 block text-xs font-medium text-fg-secondary'
  const checkCls = light
    ? 'flex cursor-pointer items-center gap-2 rounded-lg border border-gray-200 px-3 py-2 text-sm text-gray-800 hover:bg-gray-50'
    : 'flex cursor-pointer items-center gap-2 rounded-lg border border-ink-700 px-3 py-2 text-sm text-fg hover:bg-ink-800/60'

  const toggleChecklist = (field: FormField, option: string) => {
    const selected = parseChecklistValue(values[field.id])
    const next = selected.includes(option)
      ? selected.filter((o) => o !== option)
      : [...selected, option]
    onChange(field.id, serializeChecklistValue(next))
  }

  return (
    <div className="space-y-4">
      {fields.map((field) => (
        <div key={field.id}>
          <label className={labelCls}>
            {field.label}
            {field.required && <span className={light ? 'text-red-500' : 'text-red-400'}> *</span>}
          </label>
          {field.type === 'textarea' ? (
            <textarea
              rows={4}
              className={cn(inputCls, 'resize-y')}
              value={values[field.id] ?? ''}
              onChange={(e) => onChange(field.id, e.target.value)}
            />
          ) : field.type === 'select' ? (
            <select
              className={inputCls}
              value={values[field.id] ?? ''}
              onChange={(e) => onChange(field.id, e.target.value)}
            >
              <option value="">Select…</option>
              {(field.options ?? []).map((o) => (
                <option key={o} value={o}>
                  {o}
                </option>
              ))}
            </select>
          ) : field.type === 'checklist' ? (
            <div className="space-y-1.5">
              {(field.options ?? []).map((o) => {
                const checked = parseChecklistValue(values[field.id]).includes(o)
                return (
                  <label key={o} className={checkCls}>
                    <input
                      type="checkbox"
                      className="accent-brand"
                      checked={checked}
                      onChange={() => toggleChecklist(field, o)}
                    />
                    <span>{o}</span>
                  </label>
                )
              })}
            </div>
          ) : (
            <input
              type={field.type === 'date' ? 'date' : field.type === 'email' ? 'email' : 'text'}
              className={inputCls}
              value={values[field.id] ?? ''}
              onChange={(e) => onChange(field.id, e.target.value)}
            />
          )}
        </div>
      ))}
    </div>
  )
}
