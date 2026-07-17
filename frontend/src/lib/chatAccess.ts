import type { Organization, Workspace } from './types'

/** Matches backend: workspace admins/owners and org owners may create channels. */
export function canCreateChannel(
  org: Pick<Organization, 'my_role'> | null | undefined,
  workspace: Pick<Workspace, 'my_role'> | null | undefined,
) {
  return (
    workspace?.my_role === 'admin' ||
    workspace?.my_role === 'owner' ||
    (org?.my_role === 'owner' || org?.my_role === 'admin')
  )
}

export const CHAT_CREATE_PATH = '/app/chat?new=1'
