import type { OrgMember } from './types'

const ORG_LEADER_ROLES = new Set(['owner', 'admin'])

/** Org members eligible for existing-people assignment flows (excludes org owner/admin). */
export function assignableOrgMembers(members: OrgMember[]): OrgMember[] {
  return members.filter((member) => !ORG_LEADER_ROLES.has(member.role))
}
