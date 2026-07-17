import { useQuery } from '@tanstack/react-query'
import { useMemo } from 'react'
import { matchPath, useLocation, useSearchParams } from 'react-router-dom'

import {
  APP_SECTION_LABELS,
  type BreadcrumbItem,
  dashboardCrumb,
  FORM_TAB_LABELS,
  projectCrumb,
  SETTINGS_TAB_LABELS,
  TEAMS_TAB_LABELS,
  workspaceCrumb,
} from '../lib/breadcrumbs'
import { api } from '../lib/api'
import { useChannels, useCurrentContext, useProject, useSpaces, useTeams } from '../lib/queries'
import type { FormDef, TaskDetail, Whiteboard, Workspace } from '../lib/types'

function sectionCrumb(segment: string, current = false): BreadcrumbItem {
  return {
    label: APP_SECTION_LABELS[segment] ?? segment,
    href: current ? undefined : `/app/${segment}`,
    current,
  }
}

export function useAppBreadcrumbs(): BreadcrumbItem[] {
  const { pathname } = useLocation()
  const [searchParams] = useSearchParams()
  const { org, workspace } = useCurrentContext()

  const workspaceRoute = matchPath('/app/workspaces/:workspaceId', pathname)
  const projectRoute = matchPath('/app/projects/:projectId', pathname)
  const taskRoute = matchPath('/app/tasks/:taskId', pathname)
  const formRoute = matchPath('/app/forms/:formId/*', pathname)
  const whiteboardRoute = matchPath('/app/whiteboards/:whiteboardId', pathname)

  const workspaceIdParam = workspaceRoute?.params.workspaceId
  const projectIdParam = projectRoute?.params.projectId
  const taskIdParam = taskRoute?.params.taskId
  const formIdParam = formRoute?.params.formId
  const whiteboardIdParam = whiteboardRoute?.params.whiteboardId
  const isFormFill = !!formIdParam && pathname.endsWith('/fill')

  const taskQuery = useQuery({
    queryKey: ['task', taskIdParam],
    queryFn: () => api.get<TaskDetail>(`/tasks/${taskIdParam}`),
    enabled: !!taskIdParam,
    staleTime: 30_000,
  })

  const projectId = projectIdParam ?? taskQuery.data?.project_id
  const project = useProject(projectId)
  const spaces = useSpaces(project.data?.workspace_id ?? workspace?.id)

  const workspaceId =
    workspaceIdParam ?? project.data?.workspace_id ?? workspace?.id

  const workspaceQuery = useQuery({
    queryKey: ['workspace', workspaceId],
    queryFn: () => api.get<Workspace>(`/workspaces/${workspaceId}`),
    enabled: !!workspaceId && workspaceId !== workspace?.id,
    staleTime: 60_000,
  })

  const formQuery = useQuery({
    queryKey: ['form', formIdParam],
    queryFn: () => api.get<FormDef>(`/forms/${formIdParam}`),
    enabled: !!formIdParam,
    staleTime: 30_000,
  })

  const whiteboardQuery = useQuery({
    queryKey: ['whiteboard', whiteboardIdParam],
    queryFn: () => api.get<Whiteboard>(`/whiteboards/${whiteboardIdParam}`),
    enabled: !!whiteboardIdParam,
    staleTime: 30_000,
  })

  const channels = useChannels(workspace?.id)
  const teams = useTeams(workspace?.id)
  const channelId = searchParams.get('channel')
  const channelName = channels.data?.find((c) => c.id === channelId)?.name

  return useMemo(() => {
    const items: BreadcrumbItem[] = [dashboardCrumb()]

    const wsName = workspaceQuery.data?.name ?? workspace?.name
    const wsId = workspaceId

    const appendWorkspace = (current = false) => {
      if (!wsId || !wsName) return
      items.push(workspaceCrumb(wsId, wsName, current))
    }

    const appendProjectHierarchy = (projectCurrent = false) => {
      if (!project.data) return
      appendWorkspace()
      const space = spaces.data?.find((s) => s.id === project.data!.space_id)
      if (space) {
        items.push({
          label: space.name,
          href: wsId ? `/app/workspaces/${wsId}` : undefined,
        })
      }
      items.push(projectCrumb(project.data.id, project.data.name, projectCurrent))
    }

    if (pathname === '/app/dashboard') {
      items.push({ label: 'Overview', current: true })
      return items
    }

    if (pathname === '/app/workspaces') {
      items.push(sectionCrumb('workspaces', true))
      return items
    }

    if (workspaceIdParam) {
      items.push(sectionCrumb('workspaces'))
      items.push(
        workspaceCrumb(
          workspaceIdParam,
          workspaceQuery.data?.name ?? 'Workspace',
          true,
        ),
      )
      return items
    }

    if (projectIdParam) {
      appendProjectHierarchy(true)
      return items
    }

    if (taskIdParam) {
      appendProjectHierarchy()
      const task = taskQuery.data
      items.push({
        label: task ? `${task.ref} · ${task.title}` : 'Task',
        current: true,
      })
      return items
    }

    if (formIdParam) {
      items.push(sectionCrumb('forms'))
      if (wsName && wsId) appendWorkspace()
      items.push({
        label: formQuery.data?.name ?? 'Form',
        href: isFormFill ? `/app/forms/${formIdParam}` : undefined,
        current: !isFormFill,
      })
      if (isFormFill) {
        items.push({ label: 'Fill', current: true })
      } else {
        const tab = searchParams.get('tab')
        if (tab === 'submissions') {
          items.push({ label: FORM_TAB_LABELS.submissions, current: true })
        }
      }
      return items
    }

    if (whiteboardIdParam) {
      items.push(sectionCrumb('whiteboards'))
      if (wsName && wsId) appendWorkspace()
      items.push({
        label: whiteboardQuery.data?.name ?? 'Whiteboard',
        current: true,
      })
      return items
    }

    if (pathname === '/app/settings') {
      items.push(sectionCrumb('settings'))
      const tab = searchParams.get('tab') ?? 'profile'
      items.push({
        label: SETTINGS_TAB_LABELS[tab] ?? 'Profile',
        current: searchParams.get('transfer') !== '1',
      })
      if (tab === 'organization' && searchParams.get('transfer') === '1') {
        items.push({ label: 'Transfer ownership', current: true })
      }
      return items
    }

    if (pathname === '/app/teams') {
      items.push(sectionCrumb('teams'))
      if (wsName && wsId) appendWorkspace()
      const tab = searchParams.get('tab') === 'people' ? 'people' : 'teams'
      if (tab === 'people') {
        items.push({ label: TEAMS_TAB_LABELS.people, current: true })
      } else {
        const teamId = searchParams.get('team')
        const teamName = teams.data?.find((t) => t.id === teamId)?.name
        if (teamId && teamName) {
          items.push({ label: teamName, current: true })
        } else {
          items[items.length - 1] = { ...items[items.length - 1], current: true }
        }
      }
      return items
    }

    if (pathname === '/app/chat') {
      items.push(sectionCrumb('chat'))
      if (wsName && wsId) appendWorkspace()
      if (channelName) {
        items.push({ label: `#${channelName}`, current: true })
      } else {
        items[items.length - 1] = { ...items[items.length - 1], current: true }
      }
      return items
    }

    // Generic section pages: planner, list, board, sprints, notifications, apps, timesheet, whiteboards, forms
    const segment = pathname.replace(/^\/app\/?/, '').split('/')[0]
    if (segment && APP_SECTION_LABELS[segment]) {
      if (org?.name && segment !== 'dashboard') {
        // Optional context on section pages tied to workspace
        if (wsName && wsId && ['planner', 'list', 'board', 'sprints', 'timesheet', 'whiteboards', 'forms', 'apps'].includes(segment)) {
          appendWorkspace()
        }
      }
      items.push(sectionCrumb(segment, true))
      return items
    }

    items.push({ label: 'Page', current: true })
    return items
  }, [
    pathname,
    searchParams,
    org?.name,
    workspace?.id,
    workspace?.name,
    workspaceId,
    workspaceIdParam,
    workspaceQuery.data?.name,
    projectIdParam,
    project.data,
    spaces.data,
    taskIdParam,
    taskQuery.data,
    formIdParam,
    formQuery.data?.name,
    isFormFill,
    whiteboardIdParam,
    whiteboardQuery.data?.name,
    channelName,
    teams.data,
  ])
}

export function useAdminBreadcrumbs(): BreadcrumbItem[] {
  const { pathname } = useLocation()

  return useMemo(() => {
    const items: BreadcrumbItem[] = [{ label: 'Admin', href: '/admin/platform' }]

    if (pathname === '/admin/platform' || pathname === '/admin') {
      items.push({ label: 'Platform overview', current: true })
      return items
    }

    if (pathname === '/admin/organizations') {
      items.push({ label: 'Organizations', current: true })
      return items
    }

    items.push({ label: 'Page', current: true })
    return items
  }, [pathname])
}
