import { describe, expect, it, vi } from 'vitest'

vi.mock('@excalidraw/excalidraw', () => ({
  restore: vi.fn((scene) => ({
    elements: scene.elements,
    appState: scene.appState,
    files: scene.files,
  })),
}))

import { restore } from '@excalidraw/excalidraw'

import {
  boardElementsSignature,
  mergeElementsByVersion,
  restoreBoardScene,
} from '@/lib/whiteboardScene'

describe('mergeElementsByVersion', () => {
  it('keeps the higher version per element id', () => {
    const local = [{ id: 'a', version: 1, versionNonce: 1 }]
    const remote = [{ id: 'a', version: 2, versionNonce: 1 }]
    expect(mergeElementsByVersion(local, remote)).toEqual([{ id: 'a', version: 2, versionNonce: 1 }])
  })

  it('breaks version ties with versionNonce', () => {
    const local = [{ id: 'a', version: 2, versionNonce: 1 }]
    const remote = [{ id: 'a', version: 2, versionNonce: 5 }]
    expect(mergeElementsByVersion(local, remote)).toEqual([{ id: 'a', version: 2, versionNonce: 5 }])
  })

  it('merges distinct ids from both sides', () => {
    const merged = mergeElementsByVersion([{ id: 'a', version: 1 }], [{ id: 'b', version: 1 }])
    expect(merged.map((e) => e.id).sort()).toEqual(['a', 'b'])
  })
})

describe('restoreBoardScene', () => {
  it('restores empty defaults for missing content', () => {
    const scene = restoreBoardScene(null)
    expect(restore).toHaveBeenCalledWith({ elements: [], appState: {}, files: {} }, null, null)
    expect(scene.scrollToContent).toBe(true)
  })

  it('passes stored content through restore', () => {
    const content = {
      elements: [{ id: 'el-1', type: 'rectangle' }],
      appState: { zoom: 1 },
      files: { f1: { id: 'f1' } },
    }
    restoreBoardScene(content)
    expect(restore).toHaveBeenCalledWith(content, null, null)
  })
})

describe('boardElementsSignature', () => {
  it('builds a stable signature from board id and element versions', () => {
    const sig = boardElementsSignature('board-1', [
      { id: 'a', version: 1 },
      { id: 'b', version: 3 },
    ])
    expect(sig).toBe('board-1:a:1|b:3')
  })
})
