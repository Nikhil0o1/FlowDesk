import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { useAuthStore } from '@/stores/auth'

const GSI_SRC = 'https://accounts.google.com/gsi/client'

function mockGoogleSdk() {
  const renderButton = vi.fn()
  const initialize = vi.fn()
  const cancel = vi.fn()
  window.google = {
    accounts: {
      id: {
        initialize,
        renderButton,
        cancel,
      },
    },
  }
  return { renderButton, initialize, cancel }
}

describe('googleAuth', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.stubEnv('VITE_GOOGLE_CLIENT_ID', 'test-google-client-id')
    document.head.replaceChildren()
    document.body.replaceChildren()
    delete window.google
    useAuthStore.setState({
      accessToken: null,
      user: null,
      loginContext: null,
      initialized: false,
    })
  })

  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('loadGoogleSdk resolves immediately when the SDK is already present', async () => {
    mockGoogleSdk()
    const { loadGoogleSdk } = await import('@/lib/googleAuth')
    await expect(loadGoogleSdk()).resolves.toBeUndefined()
  })

  it('loadGoogleSdk injects a script and resolves on load', async () => {
    const { loadGoogleSdk } = await import('@/lib/googleAuth')
    const pending = loadGoogleSdk()
    const script = document.querySelector<HTMLScriptElement>(`script[src="${GSI_SRC}"]`)
    expect(script).toBeTruthy()
    script?.onload?.(new Event('load'))
    await expect(pending).resolves.toBeUndefined()
  })

  it('loadGoogleSdk rejects when the script fails to load', async () => {
    const { loadGoogleSdk } = await import('@/lib/googleAuth')
    const pending = loadGoogleSdk()
    const script = document.querySelector<HTMLScriptElement>(`script[src="${GSI_SRC}"]`)
    script?.onerror?.(new Event('error'))
    await expect(pending).rejects.toThrow('Google Sign-In failed to load')
  })

  it('loadGoogleSdk waits for an existing script element', async () => {
    const existing = document.createElement('script')
    existing.src = GSI_SRC
    document.head.appendChild(existing)

    const { loadGoogleSdk } = await import('@/lib/googleAuth')
    const pending = loadGoogleSdk()
    existing.dispatchEvent(new Event('load'))
    await expect(pending).resolves.toBeUndefined()
  })

  it('mountGoogleSignInButton is a no-op without a client id', async () => {
    vi.stubEnv('VITE_GOOGLE_CLIENT_ID', '')
    const { mountGoogleSignInButton } = await import('@/lib/googleAuth')
    const container = document.createElement('div')
    const cleanup = mountGoogleSignInButton(container, vi.fn())
    expect(typeof cleanup).toBe('function')
    cleanup()
    expect(container.childNodes).toHaveLength(0)
  })

  it('mountGoogleSignInButton renders the GSI button and forwards credentials', async () => {
    const { renderButton, initialize } = mockGoogleSdk()
    const { mountGoogleSignInButton } = await import('@/lib/googleAuth')
    const container = document.createElement('div')
    Object.defineProperty(container, 'offsetWidth', { value: 400, configurable: true })
    const onCredential = vi.fn()

    mountGoogleSignInButton(container, onCredential)
    await vi.waitFor(() => expect(renderButton).toHaveBeenCalled())

    expect(initialize).toHaveBeenCalledWith(
      expect.objectContaining({
        client_id: 'test-google-client-id',
        auto_select: false,
      }),
    )
    const initConfig = initialize.mock.calls[0]![0] as {
      callback: (response: { credential?: string }) => void
    }
    initConfig.callback({ credential: '  google-id-token  ' })
    expect(onCredential).toHaveBeenCalledWith('google-id-token')
    initConfig.callback({ credential: '   ' })
    expect(onCredential).toHaveBeenCalledTimes(1)
    expect(renderButton).toHaveBeenCalledWith(
      container,
      expect.objectContaining({ text: 'continue_with', width: 400 }),
    )
  })

  it('mountGoogleSignInButton cleanup cancels GSI and clears the container', async () => {
    const { cancel, renderButton } = mockGoogleSdk()
    const { mountGoogleSignInButton } = await import('@/lib/googleAuth')
    const container = document.createElement('div')
    container.appendChild(document.createElement('span'))

    const cleanup = mountGoogleSignInButton(container, vi.fn())
    await vi.waitFor(() => expect(renderButton).toHaveBeenCalled())
    cleanup()

    expect(container.childNodes).toHaveLength(0)
    expect(cancel).toHaveBeenCalled()
  })

  it('mountGoogleSignInButton cleanup ignores cancel errors', async () => {
    const { cancel, renderButton } = mockGoogleSdk()
    cancel.mockImplementation(() => {
      throw new Error('cancel failed')
    })
    const { mountGoogleSignInButton } = await import('@/lib/googleAuth')
    const container = document.createElement('div')

    const cleanup = mountGoogleSignInButton(container, vi.fn())
    await vi.waitFor(() => expect(renderButton).toHaveBeenCalled())
    expect(() => cleanup()).not.toThrow()
  })
})
