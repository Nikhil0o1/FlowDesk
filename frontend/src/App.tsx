import { Suspense, useEffect, useLayoutEffect } from 'react'
import { Navigate, Route, Routes, useLocation } from 'react-router-dom'

import { accentByKey } from './lib/accents'
import { bootstrapSession } from './lib/api'
import { loginLandingPath } from './lib/loginRouting'
import { realtime } from './lib/ws'
import { useAuthStore } from './stores/auth'
import { useUIStore } from './stores/ui'

import { CompleteWithSubtasksModal } from './components/tasks/CompleteWithSubtasksModal'
import { Toasts } from './components/ui/Toasts'
import { FullPageSpinner } from './components/ui/Spinner'
import AdminLayout from './layouts/AdminLayout'
import AppLayout from './layouts/AppLayout'
import {
  ActivateInvitePage,
  AllChannelsPage,
  AllSpacesPage,
  AllTasksPage,
  AnalyticsPage,
  AssignedCommentsPage,
  IntegrationOAuthConsentPage,
  McpOAuthConsentPage,
  MyAnalyticsPage,
  GoogleCompletePage,
  ResetPasswordPage,
  AppCenterPage,
  BoardPage,
  ChatPage,
  DashboardPage,
  DeveloperDocsPage,
  DocsHomePage,
  DocumentPage,
  NewDocumentPage,
  DocsFavoritesPage,
  DocsRecentPage,
  DocsTemplatesPage,
  DocsArchivePage,
  DocsTrashPage,
  DocsMyPage,
  DocsSharedPage,
  DocsPrivatePage,
  DocsWikisPage,
  DocsMeetingNotesPage,
  FormBuilderPage,
  FormFillPage,
  FormsPage,
  GoalsPage,
  ListPage,
  MyTasksLayout,
  MyTasksHomePage,
  AssignedToMePage,
  TodayOverduePage,
  PersonalListPage,
  LoginPage,
  NotificationsPage,
  RepliesPage,
  OrganizationsAdminPage,
  PlannerPage,
  PlatformAdminPage,
  ProjectPage,
  PublicDocumentPage,
  PublicFormPage,
  PublicTaskPage,
  SettingsPage,
  SprintsPage,
  TaskPage,
  TeamsPage,
  TimesheetPage,
  WhiteboardCanvasPage,
  WhiteboardsPage,
  WorkspaceDetailPage,
  WorkspacesPage,
} from './routes/lazyPages'

// UI-only route guard (defense in depth). Admin APIs enforce access via
// flowdesk_API `get_superadmin` on every /admin endpoint (deps.py).
function RequireAuth({ children, admin = false }: { children: React.ReactNode; admin?: boolean }) {
  const { user, initialized } = useAuthStore()
  if (!initialized) return <FullPageSpinner />
  if (!user) return <Navigate to="/login" replace />
  if (admin && !user.is_platform_superadmin) return <Navigate to="/app/dashboard" replace />
  return <>{children}</>
}

function McpOAuthLegacyRedirect() {
  const location = useLocation()
  return <Navigate to={`/oauth/mcp${location.search}`} replace />
}

export default function App() {
  const location = useLocation()
  const user = useAuthStore((s) => s.user)
  const loginContext = useAuthStore((s) => s.loginContext)
  const theme = useUIStore((s) => s.theme)
  const accent = useUIStore((s) => s.accent)

  useLayoutEffect(() => {
    const root = document.documentElement
    const apply = (dark: boolean) => root.classList.toggle('dark', dark)
    if (theme === 'auto') {
      const mq = window.matchMedia('(prefers-color-scheme: dark)')
      apply(mq.matches)
      const onChange = (e: MediaQueryListEvent) => apply(e.matches)
      mq.addEventListener('change', onChange)
      return () => mq.removeEventListener('change', onChange)
    }
    apply(theme === 'dark')
  }, [theme])

  useLayoutEffect(() => {
    const { brand, soft, rgb, onBrand, railLight, railDark } = accentByKey(accent)
    const root = document.documentElement
    root.style.setProperty('--brand', brand)
    root.style.setProperty('--brand-hover', brand)
    root.style.setProperty('--brand-soft', soft)
    root.style.setProperty('--brand-rgb', rgb)
    root.style.setProperty('--on-brand', onBrand)
    // The rail picks --rail-light or --rail-dark via the .dark class (see index.css),
    // so it stays correct even when theme is 'auto' and the OS flips.
    root.style.setProperty('--rail-light', railLight)
    root.style.setProperty('--rail-dark', railDark)
  }, [accent])

  useEffect(() => {
    const skipBootstrap = location.pathname === '/auth/google/complete'
    void bootstrapSession({ skip: skipBootstrap })
  }, [location.pathname])

  useEffect(() => {
    if (user) {
      realtime.start()
      return () => realtime.stop()
    }
  }, [user?.id])

  return (
    <>
      <Suspense fallback={<FullPageSpinner />}>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route path="/activate-invite/:token?" element={<ActivateInvitePage />} />
          <Route path="/reset-password/:token?" element={<ResetPasswordPage />} />
          <Route path="/auth/google/complete" element={<GoogleCompletePage />} />
          <Route
            path="/oauth/mcp"
            element={
              <RequireAuth>
                <McpOAuthConsentPage />
              </RequireAuth>
            }
          />
          <Route
            path="/oauth/integrations"
            element={
              <RequireAuth>
                <IntegrationOAuthConsentPage />
              </RequireAuth>
            }
          />
          {/* Public form fill (no auth) */}
          <Route path="/f/:token" element={<PublicFormPage />} />
          {/* Public read-only task (no auth) */}
          <Route path="/t/:token" element={<PublicTaskPage />} />
          {/* Public read-only document (no auth) */}
          <Route path="/d/:token" element={<PublicDocumentPage />} />

          <Route
            path="/app"
            element={
              <RequireAuth>
                <AppLayout />
              </RequireAuth>
            }
          >
            <Route index element={<Navigate to="/app/dashboard" replace />} />
            <Route path="dashboard" element={<DashboardPage />} />
            <Route path="planner" element={<PlannerPage />} />
            <Route path="list" element={<ListPage />} />
            <Route path="my-tasks" element={<MyTasksLayout />}>
              <Route index element={<MyTasksHomePage />} />
              <Route path="assigned" element={<AssignedToMePage />} />
              <Route path="today-overdue" element={<TodayOverduePage />} />
              <Route path="personal" element={<PersonalListPage />} />
            </Route>
            {/* Home shortcuts */}
            <Route path="assigned-comments" element={<AssignedCommentsPage />} />
            <Route path="all-tasks" element={<AllTasksPage />} />
            <Route path="all-spaces" element={<AllSpacesPage />} />
            <Route path="all-channels" element={<AllChannelsPage />} />
            <Route path="teams" element={<TeamsPage />} />
            <Route path="my-analytics" element={<MyAnalyticsPage />} />
            <Route path="analytics" element={<AnalyticsPage />} />
            <Route path="whiteboards" element={<WhiteboardsPage />} />
            <Route path="whiteboards/:whiteboardId" element={<WhiteboardCanvasPage />} />
            <Route path="forms" element={<FormsPage />} />
            <Route path="forms/:formId" element={<FormBuilderPage />} />
            <Route path="forms/:formId/fill" element={<FormFillPage />} />
            <Route path="timesheet" element={<TimesheetPage />} />
            <Route path="apps" element={<AppCenterPage />} />
            {/* Docs module */}
            <Route path="docs" element={<DocsHomePage />} />
            <Route path="docs/new" element={<NewDocumentPage />} />
            <Route path="docs/mine" element={<DocsMyPage />} />
            <Route path="docs/shared" element={<DocsSharedPage />} />
            <Route path="docs/private" element={<DocsPrivatePage />} />
            <Route path="docs/meeting-notes" element={<DocsMeetingNotesPage />} />
            <Route path="docs/wikis" element={<DocsWikisPage />} />
            <Route path="docs/recent" element={<DocsRecentPage />} />
            <Route path="docs/favorites" element={<DocsFavoritesPage />} />
            <Route path="docs/templates" element={<DocsTemplatesPage />} />
            <Route path="docs/archived" element={<DocsArchivePage />} />
            <Route path="docs/trash" element={<DocsTrashPage />} />
            <Route path="docs/folder/:folderId" element={<DocsHomePage />} />
            <Route path="docs/:documentId/comments" element={<DocumentPage />} />
            <Route path="docs/:documentId/styles" element={<DocumentPage />} />
            <Route path="docs/:documentId/links" element={<DocumentPage />} />
            <Route path="docs/:documentId/history" element={<DocumentPage />} />
            <Route path="docs/:documentId/activity" element={<DocumentPage />} />
            <Route path="docs/:documentId/share" element={<DocumentPage />} />
            <Route path="docs/:documentId" element={<DocumentPage />} />
            <Route path="workspaces" element={<WorkspacesPage />} />
            <Route path="workspaces/:workspaceId" element={<WorkspaceDetailPage />} />
            <Route path="projects/:projectId" element={<ProjectPage />} />
            <Route path="tasks/:taskId" element={<TaskPage />} />
            <Route path="board" element={<BoardPage />} />
            <Route path="sprints" element={<SprintsPage />} />
            <Route path="goals" element={<GoalsPage />} />
            <Route path="chat" element={<ChatPage />} />
            <Route path="notifications" element={<NotificationsPage />} />
            <Route path="replies" element={<RepliesPage />} />
            <Route path="oauth/mcp" element={<McpOAuthLegacyRedirect />} />
            <Route path="settings" element={<SettingsPage />} />
            <Route path="developers" element={<Navigate to="/app/developers/overview" replace />} />
            <Route path="developers/:slug" element={<DeveloperDocsPage />} />
          </Route>

          <Route
            path="/admin"
            element={
              <RequireAuth admin>
                <AdminLayout />
              </RequireAuth>
            }
          >
            <Route index element={<Navigate to="/admin/platform" replace />} />
            <Route path="platform" element={<PlatformAdminPage />} />
            <Route path="organizations" element={<OrganizationsAdminPage />} />
          </Route>

          <Route path="/" element={<Navigate to={loginContext ? loginLandingPath(loginContext) : '/login'} replace />} />
          <Route path="*" element={<Navigate to={loginContext ? loginLandingPath(loginContext) : '/login'} replace />} />
        </Routes>
      </Suspense>
      <Toasts />
      <CompleteWithSubtasksModal />
    </>
  )
}