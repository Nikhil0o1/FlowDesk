import { useCallback } from 'react'

import { DOC_TEMPLATES } from '../constants/templates'
import { getTemplate as getTemplateById, searchTemplates, templateToDocInput } from '../services/template.service'
import { useDocuments } from './useDocuments'

/** Built-in template library + creating documents from templates. */
export function useTemplates() {
  const { createDocument } = useDocuments()
  const templates = DOC_TEMPLATES

  const getTemplate = useCallback((id: string) => getTemplateById(id), [])

  const search = useCallback((query: string) => searchTemplates(templates, query), [templates])

  /** Create a new document seeded from a template (returns the new doc). */
  const createFromTemplate = useCallback(
    async (templateId: string, folderId: string | null = null) => {
      const template = getTemplateById(templateId)
      if (!template) return null
      return createDocument({ ...templateToDocInput(template), folderId })
    },
    [createDocument],
  )

  return { templates, getTemplate, search, createFromTemplate }
}
