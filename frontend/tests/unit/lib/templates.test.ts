import { beforeEach, describe, expect, it, vi } from 'vitest'

import { api } from '@/lib/api'
import {
  VISIBILITY_LABELS,
  applyStarterTemplate,
  applyTemplate,
  deleteTemplate,
  listTemplates,
  saveTemplate,
  updateTemplate,
} from '@/lib/templates'

describe('templates API', () => {
  beforeEach(() => {
    vi.mocked(api.get).mockResolvedValue([])
    vi.mocked(api.post).mockResolvedValue({})
    vi.mocked(api.put).mockResolvedValue({})
    vi.mocked(api.delete).mockResolvedValue({ detail: 'deleted' })
  })

  it('listTemplates fetches workspace templates', async () => {
    await listTemplates('ws-1')
    expect(api.get).toHaveBeenCalledWith('/workspaces/ws-1/templates')

    await listTemplates('ws-1', 'project')
    expect(api.get).toHaveBeenCalledWith('/workspaces/ws-1/templates?kind=project')
  })

  it('saveTemplate posts to save endpoint', async () => {
    const body = { kind: 'project' as const, source_id: 'proj-1', name: 'My template' }
    await saveTemplate(body)
    expect(api.post).toHaveBeenCalledWith('/templates/save', body)
  })

  it('applyTemplate posts to apply endpoint', async () => {
    const body = { name: 'From template', target_space_id: 'space-1' }
    await applyTemplate('tpl-1', body)
    expect(api.post).toHaveBeenCalledWith('/templates/tpl-1/apply', body)
  })

  it('applyStarterTemplate posts payload apply endpoint', async () => {
    const body = { kind: 'space' as const, name: 'Starter', payload: { statuses: [] } }
    await applyStarterTemplate(body)
    expect(api.post).toHaveBeenCalledWith('/templates/apply-payload', body)
  })

  it('updateTemplate puts template metadata', async () => {
    const body = { name: 'Renamed', visibility: 'private' as const }
    await updateTemplate('tpl-1', body)
    expect(api.put).toHaveBeenCalledWith('/templates/tpl-1', body)
  })

  it('deleteTemplate removes a template', async () => {
    await deleteTemplate('tpl-1')
    expect(api.delete).toHaveBeenCalledWith('/templates/tpl-1')
  })
})

describe('VISIBILITY_LABELS', () => {
  it('labels every visibility option', () => {
    expect(VISIBILITY_LABELS.workspace).toMatch(/workspace/i)
    expect(VISIBILITY_LABELS.admins).toMatch(/admin/i)
    expect(VISIBILITY_LABELS.private).toMatch(/only me/i)
  })
})
