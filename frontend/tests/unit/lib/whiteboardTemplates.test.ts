import { describe, expect, it, vi } from 'vitest'

const convertToExcalidrawElements = vi.fn((skeleton) =>
  skeleton.map((el: { id?: string }) => ({ ...el, converted: true })),
)

vi.mock('@excalidraw/excalidraw', () => ({
  convertToExcalidrawElements,
}))

import { WHITEBOARD_TEMPLATES, templateScene } from '@/lib/whiteboardTemplates'

describe('WHITEBOARD_TEMPLATES', () => {
  it('includes six predefined templates with skeletons', () => {
    expect(WHITEBOARD_TEMPLATES).toHaveLength(6)
    for (const tpl of WHITEBOARD_TEMPLATES) {
      expect(tpl.key).toBeTypeOf('string')
      expect(tpl.name.length).toBeGreaterThan(0)
      expect(tpl.skeleton.length).toBeGreaterThan(0)
    }
  })

  it('includes expected template keys', () => {
    const keys = WHITEBOARD_TEMPLATES.map((t) => t.key)
    expect(keys).toContain('org-chart')
    expect(keys).toContain('flowchart')
    expect(keys).toContain('kanban')
  })
})

describe('templateScene', () => {
  it('lazy-loads Excalidraw and converts skeleton to a scene', async () => {
    const tpl = WHITEBOARD_TEMPLATES[0]
    const scene = await templateScene(tpl)
    expect(convertToExcalidrawElements).toHaveBeenCalledWith(tpl.skeleton)
    expect(scene.elements[0]).toMatchObject({ converted: true })
    expect(scene.appState).toEqual({ viewBackgroundColor: '#ffffff' })
    expect(scene.files).toEqual({})
  })
})
