import { useEffect } from 'react'
import { Navigate, Route, Routes } from 'react-router-dom'

import { bootstrapSession } from './lib/api'
import { realtime } from './lib/ws'
import { useAuthStore } from './stores/auth'

import { Toasts } from './components/ui/Toasts'
import { FullPageSpinner } from './components/ui/Spinner'
import AdminLayout from './layouts/AdminLayout'
import AppLayout from './layouts/AppLayout'
import ActivateInvitePage from './pages/auth/ActivateInvitePage'
import ForgotPasswordPage from './pages/auth/ForgotPasswordPage'
import LoginPage from './pages/auth/LoginPage'
import ResetPasswordPage from './pages/auth/ResetPasswordPage'
import OrganizationsAdminPage from './pages/admin/OrganizationsAdminPage'
import PlatformAdminPage from './pages/admin/PlatformAdminPage'
import AppCenterPage from './pages/app/AppCenterPage'
import BoardPage from './pages/app/BoardPage'
import ChatPage from './pages/app/ChatPage'
import DashboardPage from './pages/app/DashboardPage'
import FormBuilderPage from './pages/app/FormBuilderPage'
import FormsPage from './pages/app/FormsPage'
import ListPage from './pages/app/ListPage'
import FormFillPage from './pages/app/FormFillPage'
import NotificationsPage from './pages/app/NotificationsPage'
import PlannerPage from './pages/app/PlannerPage'
import ProjectPage from './pages/app/ProjectPage'
import SettingsPage from './pages/app/SettingsPage'
import SprintsPage from './pages/app/SprintsPage'
import TaskPage from './pages/app/TaskPage'
import TeamsPage from './pages/app/TeamsPage'
import TimesheetPage from './pages/app/TimesheetPage'
import WhiteboardCanvasPage from './pages/app/WhiteboardCanvasPage'
import WhiteboardsPage from './pages/app/WhiteboardsPage'
import WorkspaceDetailPage from './pages/app/WorkspaceDetailPage'
import WorkspacesPage from './pages/app/WorkspacesPage'
import PublicFormPage from './pages/public/PublicFormPage'

function RequireAuth({ children, admin = false }: { children: React.ReactNode; admin?: boolean }) {
  const { user, initialized } = useAuthStore()
  if (!initialized) return <FullPageSpinner />
  if (!user) return <Navigate to="/login" replace />
  if (admin && !user.is_platform_superadmin) return <Navigate to="/app/dashboard" replace />
  return <>{children}</>
}

export default function App() {
  const user = useAuthStore((s) => s.user)

  useEffect(() => {
    void bootstrapSession()
  }, [])

  useEffect(() => {
    if (user) {
      realtime.start()
      return () => realtime.stop()
    }
  }, [user?.id])

  return (
    <>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route path="/activate-invite" element={<ActivateInvitePage />} />
        <Route path="/forgot-password" element={<ForgotPasswordPage />} />
        <Route path="/reset-password" element={<ResetPasswordPage />} />
        {/* Public form fill (no auth) */}
        <Route path="/f/:token" element={<PublicFormPage />} />

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
          <Route path="teams" element={<TeamsPage />} />
          <Route path="whiteboards" element={<WhiteboardsPage />} />
          <Route path="whiteboards/:whiteboardId" element={<WhiteboardCanvasPage />} />
          <Route path="forms" element={<FormsPage />} />
          <Route path="forms/:formId" element={<FormBuilderPage />} />
          <Route path="forms/:formId/fill" element={<FormFillPage />} />
          <Route path="timesheet" element={<TimesheetPage />} />
          <Route path="apps" element={<AppCenterPage />} />
          <Route path="workspaces" element={<WorkspacesPage />} />
          <Route path="workspaces/:workspaceId" element={<WorkspaceDetailPage />} />
          <Route path="projects/:projectId" element={<ProjectPage />} />
          <Route path="tasks/:taskId" element={<TaskPage />} />
          <Route path="board" element={<BoardPage />} />
          <Route path="sprints" element={<SprintsPage />} />
          <Route path="chat" element={<ChatPage />} />
          <Route path="notifications" element={<NotificationsPage />} />
          <Route path="settings" element={<SettingsPage />} />
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

        <Route path="/" element={<Navigate to="/app/dashboard" replace />} />
        <Route path="*" element={<Navigate to="/app/dashboard" replace />} />
      </Routes>
      <Toasts />
    </>
  )
}
