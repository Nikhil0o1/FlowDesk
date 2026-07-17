import { useEffect } from 'react'
import { useNavigate } from 'react-router-dom'

import { completeOAuthLogin } from '../../lib/api'
import { loginLandingPath, syncLoginWorkspaceStore } from '../../lib/loginRouting'
import { useAuthStore } from '../../stores/auth'
import { FullPageSpinner } from '../../components/ui/Spinner'

export default function GoogleCompletePage() {
  const navigate = useNavigate()

  useEffect(() => {
    completeOAuthLogin().then((ok) => {
      if (ok) {
        const ctx = useAuthStore.getState().loginContext!
        syncLoginWorkspaceStore(ctx)
        navigate(loginLandingPath(ctx), { replace: true })
      } else {
        navigate('/login?error=google_failed', { replace: true })
      }
    })
  }, [navigate])

  return <FullPageSpinner />
}
