import '@testing-library/jest-dom/vitest'
import { cleanup } from '@testing-library/react'
import type { ReactNode } from 'react'
import { useEffect } from 'react'
import { afterEach, vi } from 'vitest'

import './mockQueries'

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
  localStorage.clear()
  sessionStorage.clear()
  window.history.replaceState(null, '', '/')
})

// jsdom does not implement scrollTo on elements — PlannerPage relies on it
if (!HTMLElement.prototype.scrollTo) {
  HTMLElement.prototype.scrollTo = vi.fn()
}

// Stable API / WS mocks for component tests
vi.mock('@/lib/ws', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/ws')>()
  return {
    ...actual,
    realtime: {
      start: vi.fn(),
      stop: vi.fn(),
      send: vi.fn(),
      subscribe: vi.fn(() => () => {}),
      on: vi.fn(() => () => {}),
    },
  }
})

// Excalidraw CSS is not needed in jsdom and can slow module resolution.
vi.mock('@excalidraw/excalidraw/index.css', () => ({}))

const { MainMenu, Excalidraw, excalidrawApiStub } = vi.hoisted(() => {
  const excalidrawApiStub = {
    getSceneElementsIncludingDeleted: vi.fn(() => []),
    getFiles: vi.fn(() => ({})),
    addFiles: vi.fn(),
    updateScene: vi.fn(),
  }

  // MainMenu must be a callable React component — a plain object breaks
  // `<MainMenu>` in WhiteboardCanvasPage (React: "type is invalid… got: object").
  const Menu = Object.assign(
    ({ children }: { children?: ReactNode }) => children ?? null,
    {
      Item: ({ children }: { children?: ReactNode }) => children ?? null,
      Separator: () => null,
      DefaultItems: {
        SaveAsImage: () => null,
        ChangeCanvasBackground: () => null,
        ClearCanvas: () => null,
        ToggleTheme: () => null,
      },
    },
  )

  const Excalidraw = ({
    children,
    excalidrawAPI,
  }: {
    children?: ReactNode
    excalidrawAPI?: (api: typeof excalidrawApiStub) => void
  }) => {
    // Call once on mount — WhiteboardCanvasPage passes an inline callback that
    // changes every render; re-running would loop in jsdom smoke tests.
    useEffect(() => {
      excalidrawAPI?.(excalidrawApiStub)
    }, [])
    return children ?? null
  }

  return { MainMenu: Menu, Excalidraw, excalidrawApiStub }
})

vi.mock('@excalidraw/excalidraw', () => ({
  Excalidraw,
  MainMenu,
  CaptureUpdateAction: { IMMEDIATELY: 'IMMEDIATELY', NEVER: 'NEVER' },
  exportToBlob: vi.fn(),
  getSceneVersion: vi.fn(() => 1),
  restore: vi.fn((scene: Record<string, unknown>) => ({ ...scene, scrollToContent: true })),
  convertToExcalidrawElements: vi.fn((skeleton: unknown[]) =>
    skeleton.map((el) => ({ ...(el as object), converted: true })),
  ),
}))

vi.mock('@/lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api')>()
  return {
    ...actual,
    api: {
      get: vi.fn((...args: Parameters<typeof actual.api.get>) => actual.api.get(...args)),
      post: vi.fn((...args: Parameters<typeof actual.api.post>) => actual.api.post(...args)),
      put: vi.fn((...args: Parameters<typeof actual.api.put>) => actual.api.put(...args)),
      patch: vi.fn((...args: Parameters<typeof actual.api.patch>) => actual.api.patch(...args)),
      delete: vi.fn((...args: Parameters<typeof actual.api.delete>) => actual.api.delete(...args)),
      upload: vi.fn((...args: Parameters<typeof actual.api.upload>) => actual.api.upload(...args)),
    },
  }
})
