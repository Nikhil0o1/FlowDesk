import { api } from './api'
import type { UserBrief } from './types'

export type TemplateKind = 'project' | 'space'
export type TemplateVisibility = 'workspace' | 'admins' | 'private'

export interface TemplateIncludes {
  statuses: number
  custom_fields: number
  lists: number
  tasks: number
  projects: number
}

export interface Template {
  id: string
  workspace_id: string
  kind: TemplateKind
  name: string
  description: string | null
  color: string
  icon: string | null
  tags: string[]
  visibility: TemplateVisibility
  usage_count: number
  created_by: string | null
  created_at: string
  updated_at: string
  includes: TemplateIncludes | null
  creator: UserBrief | null
}

export interface TemplateApplyResult {
  kind: TemplateKind
  space_id: string | null
  project_id: string | null
  name: string
}

export interface SaveTemplateBody {
  kind: TemplateKind
  source_id: string
  name: string
  description?: string | null
  tags?: string[]
  visibility?: TemplateVisibility
  include_tasks?: boolean
}

export function listTemplates(workspaceId: string, kind?: TemplateKind) {
  const qs = kind ? `?kind=${kind}` : ''
  return api.get<Template[]>(`/workspaces/${workspaceId}/templates${qs}`)
}

export function saveTemplate(body: SaveTemplateBody) {
  return api.post<Template>('/templates/save', body)
}

export function applyTemplate(
  templateId: string,
  body: { name?: string; target_space_id?: string },
) {
  return api.post<TemplateApplyResult>(`/templates/${templateId}/apply`, body)
}

export function applyStarterTemplate(body: {
  kind: TemplateKind
  name: string
  payload: unknown
  target_space_id?: string
  workspace_id?: string
}) {
  return api.post<TemplateApplyResult>('/templates/apply-payload', body)
}

export function updateTemplate(
  templateId: string,
  body: { name?: string; description?: string | null; tags?: string[]; visibility?: TemplateVisibility; resync_from_source_id?: string; include_tasks?: boolean },
) {
  return api.put<Template>(`/templates/${templateId}`, body)
}

export function deleteTemplate(templateId: string) {
  return api.delete<{ detail: string }>(`/templates/${templateId}`)
}

export const VISIBILITY_LABELS: Record<TemplateVisibility, string> = {
  workspace: 'Everyone in workspace',
  admins: 'Admins only',
  private: 'Only me',
}
