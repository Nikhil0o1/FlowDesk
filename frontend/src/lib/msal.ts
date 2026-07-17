import type { PublicClientApplication } from '@azure/msal-browser'

const CLIENT_ID = import.meta.env.VITE_MICROSOFT_CLIENT_ID as string | undefined
const TENANT = (import.meta.env.VITE_MICROSOFT_TENANT as string | undefined) || 'common'

/** Whether Microsoft SSO is configured for this build. */
export const microsoftConfigured = !!CLIENT_ID

/** MSAL must use sessionStorage for redirect flows — memoryStorage cannot
 * survive the full-page round-trip to Microsoft (MSAL: in_mem_redirect_unavailable).
 * Tokens are cleared via clearCache() as soon as we have the id_token for our API. */
export const MSAL_CACHE_LOCATION = 'sessionStorage' as const

// Set right before a redirect sign-in starts; survives the full-page round-trip
// (sessionStorage) so the boot handler knows a Microsoft response is expected even
// if the code fragment was stripped by an intermediate navigation. Not a token.
const MS_PENDING_KEY = 'flowdesk.ms_pending'

let appPromise: Promise<PublicClientApplication> | null = null

/** Lazily create + initialize the MSAL app (keeps @azure/msal-browser out of the main bundle). */
async function getApp(): Promise<PublicClientApplication> {
  if (!CLIENT_ID) {
    throw new Error('Microsoft SSO is not configured. Set VITE_MICROSOFT_CLIENT_ID.')
  }
  if (!appPromise) {
    appPromise = (async () => {
      const { PublicClientApplication } = await import('@azure/msal-browser')
      const app = new PublicClientApplication({
        auth: {
          clientId: CLIENT_ID,
          authority: `https://login.microsoftonline.com/${TENANT}`,
          // The app origin — registered as a SPA redirect URI in Entra.
          redirectUri: window.location.origin,
        },
        // sessionStorage keeps PKCE/state across loginRedirect (required). clearCache()
        // runs in consumeMicrosoftRedirect() once we have the id_token for the backend.
        cache: { cacheLocation: MSAL_CACHE_LOCATION },
      })
      await app.initialize()
      return app
    })()
  }
  return appPromise
}

/**
 * Remove any stale "interaction in progress" marker MSAL left behind after an
 * interrupted earlier attempt. Without this, MSAL refuses to start a new sign-in
 * and throws `interaction_in_progress`. The marker is just a storage key, so we
 * clear it directly (version-agnostic) before kicking off a fresh redirect.
 */
function clearStaleInteraction(): void {
  for (const store of [window.localStorage, window.sessionStorage]) {
    try {
      const keys: string[] = []
      for (let i = 0; i < store.length; i++) {
        const k = store.key(i)
        if (k && k.includes('interaction.status')) keys.push(k)
      }
      keys.forEach((k) => store.removeItem(k))
    } catch {
      /* storage unavailable — nothing to clear */
    }
  }
}

function setPendingFlag(): void {
  try {
    sessionStorage.setItem(MS_PENDING_KEY, '1')
  } catch {
    /* storage unavailable */
  }
}

function isPending(): boolean {
  try {
    return sessionStorage.getItem(MS_PENDING_KEY) === '1'
  } catch {
    return false
  }
}

function clearPendingFlag(): void {
  try {
    sessionStorage.removeItem(MS_PENDING_KEY)
  } catch {
    /* storage unavailable */
  }
}

/**
 * Start Microsoft sign-in via a full-page redirect.
 *
 * We deliberately avoid loginPopup: Microsoft's sign-in pages send a
 * Cross-Origin-Opener-Policy header that severs the popup↔opener link (it puts
 * the popup in a separate browsing-context group), so the opener can never read
 * the auth code back out of the popup and the flow hangs on "Signing in…" — this
 * bites personal Microsoft accounts especially. A top-level redirect keeps the
 * whole flow in one browsing context (and one storage), which is the robust,
 * COOP-proof path.
 *
 * This navigates the whole window away; it does not return on success.
 */
export async function microsoftLoginRedirect(): Promise<void> {
  const app = await getApp()
  clearStaleInteraction()
  setPendingFlag()
  try {
    await app.loginRedirect({ scopes: ['openid', 'profile', 'email'], prompt: 'select_account' })
  } catch (err) {
    clearPendingFlag()
    throw err
  }
}

/**
 * If the current URL carries a Microsoft auth response, complete it and return
 * the ID token (audience = our app) for the backend to verify. Returns null when
 * there's nothing to complete. Safe to call on every app boot.
 */
export async function consumeMicrosoftRedirect(): Promise<string | null> {
  if (!microsoftConfigured) return null
  const urlHasResponse = /[#?&](code|error|id_token|access_token)=/.test(
    window.location.hash + window.location.search,
  )
  if (!urlHasResponse && !isPending()) return null

  const app = await getApp()

  let idToken: string | null = null

  // 1) Normal path: process the auth response in the current URL. navigateToLoginRequestUrl
  //    is a per-call option in MSAL v5 — false stops MSAL from navigating back to
  //    the sign-in page (which would strip the code before we read it).
  try {
    const result = await app.handleRedirectPromise({ navigateToLoginRequestUrl: false })
    if (result?.idToken) idToken = result.idToken
  } catch (err) {
    console.warn('[MS-SSO] handleRedirectPromise error:', err)
  }

  // 2) Safety net: if an earlier boot already processed the code and navigated
  //    away before we could read it, MSAL may still have the ID token in its
  //    in-memory cache for this page session.
  if (!idToken) {
    const accounts = app.getAllAccounts()
    if (accounts.length > 0) {
      try {
        const silent = await app.acquireTokenSilent({
          account: accounts[0],
          scopes: ['openid', 'profile', 'email'],
        })
        if (silent?.idToken) idToken = silent.idToken
      } catch (err) {
        console.warn('[MS-SSO] acquireTokenSilent failed:', err)
      }
    }
  }

  clearPendingFlag()

  // Drop MSAL token artifacts as soon as we have what the backend needs.
  try {
    await app.clearCache()
  } catch (err) {
    console.warn('[MS-SSO] clearCache failed:', err)
  }

  return idToken
}

/** Map MSAL configuration errors to a short user-facing message. */
export function microsoftLoginErrorMessage(err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err)
  if (/in_mem_redirect_unavailable|ms_mam_redirect_unavailable/i.test(raw)) {
    return 'Microsoft sign-in could not start in this browser. Try disabling strict privacy shields for this site, or use email sign-in.'
  }
  return raw
}
