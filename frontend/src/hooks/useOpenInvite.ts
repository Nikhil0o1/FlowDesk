import { useCallback } from 'react'
import { useLocation } from 'react-router-dom'

import {
  defaultInvitePins,
  resolvePeopleInviteFlow,
  resolveScopedInviteFlow,
  type PeopleInviteFlowKind,
} from '../lib/inviteFlow'
import { useCurrentContext, useUserRoles } from '../lib/queries'
import { useUIStore } from '../stores/ui'

/** Opens the people choice dialog for scoped admins, or the standard invite modal. */
export function useOpenInvite() {
  const location = useLocation()
  const { org, workspace } = useCurrentContext()
  const { data: roles } = useUserRoles()
  const setInviteOpen = useUIStore((s) => s.setInviteOpen)
  const setPeopleInviteChoiceOpen = useUIStore((s) => s.setPeopleInviteChoiceOpen)
  const setExistingPeopleOpen = useUIStore((s) => s.setExistingPeopleOpen)
  const setInviteWorkspaceId = useUIStore((s) => s.setInviteWorkspaceId)
  const setInviteFlowKind = useUIStore((s) => s.setInviteFlowKind)
  const setInviteSpaceId = useUIStore((s) => s.setInviteSpaceId)
  const setInviteProjectId = useUIStore((s) => s.setInviteProjectId)

  return useCallback(
    (options?: {
      flowKind?: PeopleInviteFlowKind
      workspaceId?: string | null
      spaceId?: string | null
      projectId?: string | null
      /** Skip the new/existing choice and open the existing-people picker directly. */
      existingOnly?: boolean
    }) => {
      const peopleTabFlow = resolvePeopleInviteFlow(
        location.pathname,
        location.search,
        org,
        workspace,
        roles,
      )
      const scopedFlow = resolveScopedInviteFlow(org, workspace, roles)
      const flow = options?.flowKind ?? peopleTabFlow ?? scopedFlow

      if (flow && roles) {
        const pins = defaultInvitePins(flow, workspace, roles, {
          workspaceId: options?.workspaceId,
          spaceId: options?.spaceId,
          projectId: options?.projectId,
        })
        setInviteFlowKind(flow)
        setInviteWorkspaceId(pins.workspaceId)
        setInviteSpaceId(pins.spaceId)
        setInviteProjectId(pins.projectId)

        if (options?.existingOnly) {
          setPeopleInviteChoiceOpen(false)
          setExistingPeopleOpen(true)
          return
        }

        setExistingPeopleOpen(false)
        setPeopleInviteChoiceOpen(true)
        return
      }

      setInviteFlowKind(null)
      setInviteWorkspaceId(null)
      setInviteSpaceId(null)
      setInviteProjectId(null)
      setPeopleInviteChoiceOpen(false)
      setExistingPeopleOpen(false)
      setInviteOpen(true)
    },
    [
      location.pathname,
      location.search,
      org,
      workspace,
      roles,
      setInviteOpen,
      setPeopleInviteChoiceOpen,
      setExistingPeopleOpen,
      setInviteWorkspaceId,
      setInviteFlowKind,
      setInviteSpaceId,
      setInviteProjectId,
    ],
  )
}
