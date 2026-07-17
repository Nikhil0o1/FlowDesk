vi.unmock('@/lib/ws')

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const clearAuth = vi.fn()

vi.mock('@/stores/auth', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/stores/auth')>()
  return {
    ...actual,
    useAuthStore: {
      getState: () => ({
        accessToken: 'test-token',
        clear: clearAuth,
      }),
    },
  }
})

vi.mock('@/lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api')>()
  return {
    ...actual,
    tryRefresh: vi.fn().mockResolvedValue('ok'),
  }
})

vi.mock('@/lib/env', () => ({
  API_ORIGIN: '',
  API_BASE: '/api/v1',
  DEV_BACKEND_ORIGIN: 'http://localhost:8000',
}))

const { realtime, usePresenceStore } =
  await vi.importActual<typeof import('@/lib/ws')>('@/lib/ws')
const { tryRefresh } = await import('@/lib/api')

class MockWebSocket {
  static OPEN = 1
  static instances: MockWebSocket[] = []
  readyState = MockWebSocket.OPEN
  url = ''
  onopen: (() => void) | null = null
  onmessage: ((event: { data: string }) => void) | null = null
  onclose: ((event: { code: number }) => void) | null = null
  send = vi.fn()
  close = vi.fn()

  constructor(url: string) {
    this.url = url
    MockWebSocket.instances.push(this)
    queueMicrotask(() => this.onopen?.())
  }

  static get last() {
    return MockWebSocket.instances.at(-1)
  }
}

describe('usePresenceStore', () => {
  beforeEach(() => {
    usePresenceStore.setState({ online: new Set() })
  })

  it('setOnline replaces the online set', () => {
    usePresenceStore.getState().setOnline(['u1', 'u2'])
    expect([...usePresenceStore.getState().online]).toEqual(['u1', 'u2'])
  })

  it('add and remove mutate the online set', () => {
    usePresenceStore.getState().add('u1')
    usePresenceStore.getState().add('u2')
    usePresenceStore.getState().remove('u1')
    expect([...usePresenceStore.getState().online]).toEqual(['u2'])
  })
})

describe('realtime client', () => {
  beforeEach(() => {
    MockWebSocket.instances = []
    vi.stubGlobal('WebSocket', MockWebSocket as unknown as typeof WebSocket)
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ ticket: 'test-token' }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      ),
    )
    vi.useFakeTimers()
    realtime.stop()
  })

  afterEach(() => {
    realtime.stop()
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it('connects with token and dispatches subscribed events', async () => {
    const handler = vi.fn()
    const off = realtime.on('task.updated', handler)
    realtime.start()

    await vi.waitFor(() => {
      expect(MockWebSocket.last?.url).toContain('ticket=test-token')
      expect(MockWebSocket.last?.url).toMatch(/^ws:\/\/localhost:8000\/api\/v1\/ws/)
    })

    MockWebSocket.last?.onmessage?.({
      data: JSON.stringify({ type: 'task.updated', payload: { id: 't1' }, task_id: 't1' }),
    })
    expect(handler).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'task.updated', task_id: 't1' }),
    )
    off()
  })

  it('updates presence state from presence events', async () => {
    realtime.start()
    await vi.waitFor(() => expect(MockWebSocket.instances.length).toBeGreaterThan(0))

    MockWebSocket.last?.onmessage?.({
      data: JSON.stringify({ type: 'presence.state', payload: { online_user_ids: ['u1'] } }),
    })
    expect([...usePresenceStore.getState().online]).toEqual(['u1'])

    MockWebSocket.last?.onmessage?.({
      data: JSON.stringify({ type: 'presence.online', payload: { user_id: 'u2' } }),
    })
    expect([...usePresenceStore.getState().online]).toEqual(['u1', 'u2'])

    MockWebSocket.last?.onmessage?.({
      data: JSON.stringify({ type: 'presence.offline', payload: { user_id: 'u1' } }),
    })
    expect([...usePresenceStore.getState().online]).toEqual(['u2'])
  })

  it('send posts JSON when socket is open', async () => {
    realtime.start()
    await vi.waitFor(() => expect(MockWebSocket.last).toBeDefined())
    realtime.send({ type: 'ping' })
    expect(MockWebSocket.last?.send).toHaveBeenCalledWith(JSON.stringify({ type: 'ping' }))
  })

  it('refreshes token and reconnects on 4401 close', async () => {
    realtime.start()
    await vi.waitFor(() => expect(MockWebSocket.last).toBeDefined())

    MockWebSocket.last?.onclose?.({ code: 4401 })
    await vi.advanceTimersByTimeAsync(1000)

    expect(tryRefresh).toHaveBeenCalled()
  })

  it('clears auth when refresh is denied', async () => {
    vi.mocked(tryRefresh).mockResolvedValueOnce('denied')
    realtime.start()
    await vi.waitFor(() => expect(MockWebSocket.last).toBeDefined())

    MockWebSocket.last?.onclose?.({ code: 4401 })
    await vi.advanceTimersByTimeAsync(1000)

    expect(clearAuth).toHaveBeenCalled()
  })

  it('stop closes the socket and prevents reconnect', async () => {
    realtime.start()
    await vi.waitFor(() => expect(MockWebSocket.last).toBeDefined())
    const ws = MockWebSocket.last!
    realtime.stop()
    expect(ws.close).toHaveBeenCalled()

    ws.onclose?.({ code: 1000 })
    await vi.advanceTimersByTimeAsync(5000)
    expect(MockWebSocket.instances).toHaveLength(1)
  })
})
