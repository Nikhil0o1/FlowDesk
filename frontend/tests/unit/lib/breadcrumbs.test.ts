import { describe, expect, it } from 'vitest'

import {
  APP_SECTION_LABELS,
  dashboardCrumb,
  projectCrumb,
  SETTINGS_TAB_LABELS,
  workspaceCrumb,
} from '@/lib/breadcrumbs'

describe('breadcrumbs', () => {
  it('exposes section label maps', () => {
    expect(APP_SECTION_LABELS.dashboard).toBe('Overview')
    expect(SETTINGS_TAB_LABELS.organization).toBe('Organization')
  })

  it('builds dashboard, workspace, and project crumbs', () => {
    expect(dashboardCrumb()).toEqual({ label: 'Dashboard', href: '/app/dashboard' })
    expect(workspaceCrumb('ws-1', 'Alpha')).toEqual({
      label: 'Alpha',
      href: '/app/workspaces/ws-1',
      current: false,
    })
    expect(projectCrumb('p-1', 'Phoenix', true)).toEqual({
      label: 'Phoenix',
      href: undefined,
      current: true,
    })
  })
})
