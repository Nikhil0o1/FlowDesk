import type { LoginContext } from './types'
import { useWorkspaceStore } from '../stores/workspace'
import { safeAppPath } from './safeUrl'

/** Home dashboard — default post-login and new-user onboarding landing. */
export const DEFAULT_LOGIN_LANDING = '/app/dashboard'

/** Post-login route from server-resolved membership context. */
export function loginLandingPath(ctx: LoginContext): string {
  return safeAppPath(ctx.redirect_to) ?? DEFAULT_LOGIN_LANDING
}

/** Align org/workspace picker with the membership used for login routing. */
export function syncLoginWorkspaceStore(ctx: LoginContext): void {
  const { setOrg, setWorkspace } = useWorkspaceStore.getState()
  if (ctx.organization_id) setOrg(ctx.organization_id)
  if (ctx.workspace_id) setWorkspace(ctx.workspace_id)
}
