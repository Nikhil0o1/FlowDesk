import { describe, expect, it } from 'vitest'

import {
  defaultInvitePins,
  inviteOpensPeopleChoice,
  resolvePeopleInviteFlow,
  resolveScopedInviteFlow,
} from '@/lib/inviteFlow'
import type { UserRoleSummary } from '@/lib/types'

const baseRoles = (overrides: Partial<UserRoleSummary> = {}): UserRoleSummary => ({
  highest_role: 'member',
  workspace_roles: [],
  space_roles: [],
  project_roles: [],
  ...overrides,
})

describe('inviteFlow', () => {
  it('opens people choice for workspace admin on people tab', () => {
    expect(
      resolvePeopleInviteFlow(
        '/app/teams',
        'tab=people',
        { my_role: 'member' },
        { id: 'ws1', my_role: 'admin' },
        baseRoles(),
      ),
    ).toBe('workspace')
  })

  it('resolves scoped invite flow from home for workspace admin', () => {
    expect(
      resolveScopedInviteFlow(
        { my_role: 'member' },
        { id: 'ws1', my_role: 'admin' },
        baseRoles(),
      ),
    ).toBe('workspace')
  })

  it('resolves workspace flow for workspace owner', () => {
    expect(
      resolveScopedInviteFlow(
        { my_role: 'member' },
        { id: 'ws1', my_role: 'owner' },
        baseRoles(),
      ),
    ).toBe('workspace')
  })

  it('resolves workspace flow from workspace_roles when current workspace is not admin', () => {
    expect(
      resolveScopedInviteFlow(
        { my_role: 'member' },
        { id: 'ws1', my_role: 'member' },
        baseRoles({
          workspace_roles: [{ workspace_id: 'ws2', workspace_name: 'Other', role: 'admin' }],
        }),
      ),
    ).toBe('workspace')
  })

  it('does not resolve scoped invite flow off the people tab', () => {
    expect(
      resolvePeopleInviteFlow(
        '/app/home',
        '',
        { my_role: 'member' },
        { id: 'ws1', my_role: 'admin' },
        baseRoles(),
      ),
    ).toBeNull()
  })

  it('does not resolve when roles are missing or user is org leader', () => {
    expect(resolveScopedInviteFlow({ my_role: 'admin' }, null, baseRoles())).toBeNull()
    expect(resolveScopedInviteFlow({ my_role: 'member' }, null, undefined)).toBeNull()
    expect(
      resolveScopedInviteFlow({ my_role: 'member' }, { id: 'ws1', my_role: 'member' }, baseRoles()),
    ).toBeNull()
  })

  it('opens people choice for space admin', () => {
    expect(
      resolvePeopleInviteFlow(
        '/app/teams',
        'tab=people',
        { my_role: 'member' },
        { id: 'ws1', my_role: 'member' },
        baseRoles({
          highest_role: 'space_admin',
          space_roles: [
            {
              space_id: 'sp1',
              space_name: 'Product',
              workspace_id: 'ws1',
              workspace_name: 'Main',
              role: 'admin',
            },
          ],
        }),
      ),
    ).toBe('space')
  })

  it('opens people choice for project admin', () => {
    expect(
      resolvePeopleInviteFlow(
        '/app/teams',
        'tab=people',
        { my_role: 'member' },
        { id: 'ws1', my_role: 'member' },
        baseRoles({
          highest_role: 'project_admin',
          project_roles: [
            {
              project_id: 'p1',
              project_name: 'App',
              space_name: 'Product',
              workspace_id: 'ws1',
              role: 'admin',
            },
          ],
        }),
      ),
    ).toBe('project')
  })

  it('does not open for org leaders', () => {
    expect(
      resolvePeopleInviteFlow(
        '/app/teams',
        'tab=people',
        { my_role: 'admin' },
        { id: 'ws1', my_role: 'admin' },
        baseRoles(),
      ),
    ).toBeNull()
  })

  it('pins workspace id for workspace admin invite', () => {
    expect(
      defaultInvitePins(
        'workspace',
        { id: 'ws-current', my_role: 'admin' },
        baseRoles({
          workspace_roles: [{ workspace_id: 'ws-other', workspace_name: 'Other', role: 'admin' }],
        }),
      ),
    ).toEqual({ workspaceId: 'ws-current', spaceId: null, projectId: null })
  })

  it('falls back to first admin workspace when current workspace is not admin', () => {
    expect(
      defaultInvitePins(
        'workspace',
        { id: 'ws-current', my_role: 'member' },
        baseRoles({
          workspace_roles: [{ workspace_id: 'ws-other', workspace_name: 'Other', role: 'admin' }],
        }),
      ),
    ).toEqual({ workspaceId: 'ws-other', spaceId: null, projectId: null })
  })

  it('pins first admin space when opening from home', () => {
    expect(
      defaultInvitePins('space', { id: 'ws1', my_role: 'member' }, baseRoles({
        space_roles: [
          {
            space_id: 'sp1',
            space_name: 'Product',
            workspace_id: 'ws1',
            workspace_name: 'Main',
            role: 'admin',
          },
        ],
      })),
    ).toEqual({ workspaceId: 'ws1', spaceId: 'sp1', projectId: null })
  })

  it('pins project scope preferring current workspace and honoring overrides', () => {
    const roles = baseRoles({
      project_roles: [
        {
          project_id: 'p-other',
          project_name: 'Other',
          space_name: 'Ops',
          workspace_id: 'ws2',
          role: 'admin',
        },
        {
          project_id: 'p1',
          project_name: 'App',
          space_name: 'Product',
          workspace_id: 'ws1',
          role: 'admin',
        },
      ],
    })

    expect(defaultInvitePins('project', { id: 'ws1', my_role: 'member' }, roles)).toEqual({
      workspaceId: 'ws1',
      spaceId: null,
      projectId: 'p1',
    })

    expect(
      defaultInvitePins('project', null, roles, {
        workspaceId: 'ws9',
        projectId: 'p-other',
      }),
    ).toEqual({
      workspaceId: 'ws9',
      spaceId: null,
      projectId: 'p-other',
    })
  })

  it('pins space scope with override and without current workspace', () => {
    const roles = baseRoles({
      space_roles: [
        {
          space_id: 'sp1',
          space_name: 'Product',
          workspace_id: 'ws1',
          workspace_name: 'Main',
          role: 'admin',
        },
      ],
    })

    expect(
      defaultInvitePins('space', null, roles, { spaceId: 'sp1', workspaceId: 'ws1' }),
    ).toEqual({ workspaceId: 'ws1', spaceId: 'sp1', projectId: null })
  })

  it('inviteOpensPeopleChoice is true on people tab and from global invite', () => {
    const org = { my_role: 'member' as const }
    const workspace = { id: 'ws1', my_role: 'admin' as const }
    const roles = baseRoles()

    expect(inviteOpensPeopleChoice('/app/teams', 'tab=people', org, workspace, roles)).toBe(true)
    expect(inviteOpensPeopleChoice('/app/home', '', org, workspace, roles)).toBe(true)
    expect(inviteOpensPeopleChoice('/app/home', '', org, workspace, undefined)).toBe(false)
  })
})
