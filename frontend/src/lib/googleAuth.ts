import { useAuthStore, refreshStore, sessionHint } from '../stores/auth'
import { queryClient } from './queryClient'

const GSI_SRC = 'https://accounts.google.com/gsi/client'

type CredentialCallback = (idToken: string) => void

declare global {
  interface Window {
    google?: {
      accounts: {
        id: {
          initialize: (config: {
            client_id: string
            callback: (response: { credential?: string }) => void
            auto_select?: boolean
            cancel_on_tap_outside?: boolean
            itp_support?: boolean
          }) => void
          renderButton: (
            parent: HTMLElement,
            options: {
              type?: string
              theme?: string
              size?: string
              width?: number
              text?: string
            },
          ) => void
          cancel: () => void
        }
      }
    }
  }
}

let sdkPromise: Promise<void> | null = null
let gsiInitialized = false
let activeCredentialHandler: CredentialCallback | null = null

export function loadGoogleSdk(): Promise<void> {
  if (window.google?.accounts?.id) return Promise.resolve()
  if (!sdkPromise) {
    sdkPromise = new Promise((resolve, reject) => {
      const existing = document.querySelector<HTMLScriptElement>(`script[src="${GSI_SRC}"]`)
      if (existing) {
        existing.addEventListener('load', () => resolve(), { once: true })
        existing.addEventListener('error', () => reject(new Error('Google Sign-In failed to load')), {
          once: true,
        })
        return
      }
      const script = document.createElement('script')
      script.src = GSI_SRC
      script.async = true
      script.defer = true
      script.onload = () => resolve()
      script.onerror = () => reject(new Error('Google Sign-In failed to load'))
      document.head.appendChild(script)
    })
  }
  return sdkPromise
}

function ensureGsiInitialized(clientId: string): Promise<void> {
  return loadGoogleSdk().then(() => {
    if (!window.google?.accounts?.id || gsiInitialized) return
    window.google.accounts.id.initialize({
      client_id: clientId,
      callback: (response) => {
        const credential = response.credential?.trim()
        if (credential && activeCredentialHandler) activeCredentialHandler(credential)
      },
      auto_select: false,
      cancel_on_tap_outside: true,
      itp_support: true,
    })
    gsiInitialized = true
  })
}

export function mountGoogleSignInButton(
  container: HTMLElement,
  onCredential: CredentialCallback,
): () => void {
  const clientId = (import.meta.env.VITE_GOOGLE_CLIENT_ID as string | undefined)?.trim()
  if (!clientId) return () => {}

  let cancelled = false
  activeCredentialHandler = onCredential

  void ensureGsiInitialized(clientId)
    .then(() => {
      if (cancelled || !window.google?.accounts?.id) return
      container.replaceChildren()
      window.google.accounts.id.renderButton(container, {
        type: 'standard',
        theme: 'outline',
        size: 'large',
        width: Math.max(container.offsetWidth, 320),
        text: 'continue_with',
      })
    })
    .catch(() => {
      /* LoginPage surfaces load errors via its own state if needed */
    })

  return () => {
    cancelled = true
    if (activeCredentialHandler === onCredential) activeCredentialHandler = null
    container.replaceChildren()
    try {
      window.google?.accounts?.id?.cancel()
    } catch {
      /* ignore */
    }
  }
}

/** Clear stale session markers before starting any SSO flow. */
export function resetAuthClientState(): void {
  sessionHint.clear()
  refreshStore.clear()
  useAuthStore.getState().clear()
  queryClient.clear()
}
