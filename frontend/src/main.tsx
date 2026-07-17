import { QueryClientProvider } from '@tanstack/react-query'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'

import App from './App'
import { redirectToCanonicalOriginIfNeeded } from './lib/canonicalOrigin'
import { loginWithMicrosoft } from './lib/api'
import { initClarity } from './lib/clarity'
import { assertProductionApiConfig } from './lib/env'
import { queryClient } from './lib/queryClient'
import { consumeMicrosoftRedirect, microsoftLoginErrorMessage } from './lib/msal'
import './index.css'

assertProductionApiConfig()
initClarity()

function render() {
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <QueryClientProvider client={queryClient}>
        <BrowserRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
          <App />
        </BrowserRouter>
      </QueryClientProvider>
    </StrictMode>,
  )
}

// Microsoft (MSAL) sign-in returns via a full-page redirect. If we're landing
// back from Microsoft, finish the handshake BEFORE the app mounts — otherwise
// the router navigates and strips the auth response from the URL before MSAL can
// read it. On success we establish the session; either way we drop the OAuth
// fragment from the URL and then boot the app normally.
async function boot() {
  try {
    const idToken = await consumeMicrosoftRedirect()
    if (idToken) await loginWithMicrosoft(idToken)
  } catch (err) {
    console.error('[MS-SSO] Sign-in failed:', err)
    try {
      sessionStorage.setItem('flowdesk.ms_login_error', microsoftLoginErrorMessage(err))
    } catch {
      /* sessionStorage unavailable — fall through */
    }
  } finally {
    if (/[#?&](code|error|id_token|access_token)=/.test(window.location.hash + window.location.search)) {
      window.history.replaceState(null, '', window.location.pathname)
    }
    render()
  }
}

void (redirectToCanonicalOriginIfNeeded() ? undefined : boot())
