import { DOC_TEMPLATES } from '../constants/templates'
import type { DocTemplate } from '../types/template'

/**
 * Template helpers (pure). Built-in templates ship as a constant; custom
 * templates (Phase 3) will merge in from the API here.
 *
 * TODO(backend): fetch + persist custom templates; keep built-ins as defaults.
 */

export function getTemplate(id: string): DocTemplate | undefined {
  return DOC_TEMPLATES.find((t) => t.id === id)
}

/** Search templates by name, description or category. */
export function searchTemplates(templates: DocTemplate[], query: string): DocTemplate[] {
  const q = query.trim().toLowerCase()
  if (!q) return templates
  return templates.filter(
    (t) =>
      t.name.toLowerCase().includes(q) ||
      t.description.toLowerCase().includes(q) ||
      t.category.toLowerCase().includes(q),
  )
}

/** Payload for creating a document from a template. */
export function templateToDocInput(template: DocTemplate) {
  return { title: template.name, content: template.content, templateId: template.id }
}
