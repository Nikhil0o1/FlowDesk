import { lazy } from 'react'

/**
 * Route-level code splitting — each page becomes its own async chunk so the
 * login shell and lightweight public routes stay out of the main bundle.
 *
 * Layouts (AppLayout, AdminLayout) stay eagerly loaded because they wrap
 * many routes and are comparatively small.
 */

// Auth
export const LoginPage = lazy(() => import('../pages/auth/LoginPage'))
export const ActivateInvitePage = lazy(() => import('../pages/auth/ActivateInvitePage'))
export const ResetPasswordPage = lazy(() => import('../pages/auth/ResetPasswordPage'))
export const GoogleCompletePage = lazy(() => import('../pages/auth/GoogleCompletePage'))

// Public (no auth)
export const PublicFormPage = lazy(() => import('../pages/public/PublicFormPage'))
export const PublicTaskPage = lazy(() => import('../pages/public/PublicTaskPage'))
export const PublicDocumentPage = lazy(() => import('../modules/docs/pages/PublicDocumentPage'))

// App workspace
export const DashboardPage = lazy(() => import('../pages/app/DashboardPage'))
export const PlannerPage = lazy(() => import('../pages/app/PlannerPage'))
export const ListPage = lazy(() => import('../pages/app/ListPage'))
export const MyTasksLayout = lazy(() => import('../pages/app/myTasks/MyTasksLayout'))
export const MyTasksHomePage = lazy(() => import('../pages/app/myTasks/MyTasksHomePage'))
export const AssignedToMePage = lazy(() => import('../pages/app/myTasks/AssignedToMePage'))
export const TodayOverduePage = lazy(() => import('../pages/app/myTasks/TodayOverduePage'))
export const PersonalListPage = lazy(() => import('../pages/app/myTasks/PersonalListPage'))
export const TeamsPage = lazy(() => import('../pages/app/TeamsPage'))
export const AnalyticsPage = lazy(() => import('../pages/app/AnalyticsPage'))
export const MyAnalyticsPage = lazy(() => import('../pages/app/MyAnalyticsPage'))
export const WhiteboardsPage = lazy(() => import('../pages/app/WhiteboardsPage'))
export const WhiteboardCanvasPage = lazy(() => import('../pages/app/WhiteboardCanvasPage'))
export const FormsPage = lazy(() => import('../pages/app/FormsPage'))
export const FormBuilderPage = lazy(() => import('../pages/app/FormBuilderPage'))
export const FormFillPage = lazy(() => import('../pages/app/FormFillPage'))
export const TimesheetPage = lazy(() => import('../pages/app/TimesheetPage'))
export const AppCenterPage = lazy(() => import('../pages/app/AppCenterPage'))
export const WorkspacesPage = lazy(() => import('../pages/app/WorkspacesPage'))
export const WorkspaceDetailPage = lazy(() => import('../pages/app/WorkspaceDetailPage'))
export const ProjectPage = lazy(() => import('../pages/app/ProjectPage'))
export const TaskPage = lazy(() => import('../pages/app/TaskPage'))
export const BoardPage = lazy(() => import('../pages/app/BoardPage'))
export const SprintsPage = lazy(() => import('../pages/app/SprintsPage'))
export const GoalsPage = lazy(() => import('../pages/app/GoalsPage'))
export const ChatPage = lazy(() => import('../pages/app/ChatPage'))
export const NotificationsPage = lazy(() => import('../pages/app/NotificationsPage'))
export const RepliesPage = lazy(() => import('../pages/app/RepliesPage'))
export const SettingsPage = lazy(() => import('../pages/app/SettingsPage'))
export const DeveloperDocsPage = lazy(() => import('../modules/developerDocs/DeveloperDocsPage'))
export const McpOAuthConsentPage = lazy(() => import('../pages/app/McpOAuthConsentPage'))
export const IntegrationOAuthConsentPage = lazy(
  () => import('../pages/app/IntegrationOAuthConsentPage'),
)
// Docs module (see modules/docs)
export const DocsHomePage = lazy(() => import('../modules/docs/pages/DocsHome'))
export const DocumentPage = lazy(() => import('../modules/docs/pages/DocumentPage'))
export const NewDocumentPage = lazy(() => import('../modules/docs/pages/NewDocumentRedirect'))
export const DocsFavoritesPage = lazy(() => import('../modules/docs/pages/FavoritesPage'))
export const DocsRecentPage = lazy(() => import('../modules/docs/pages/RecentPage'))
export const DocsTemplatesPage = lazy(() => import('../modules/docs/pages/TemplatesPage'))
export const DocsArchivePage = lazy(() => import('../modules/docs/pages/ArchivePage'))
export const DocsTrashPage = lazy(() => import('../modules/docs/pages/TrashPage'))
export const DocsMyPage = lazy(() => import('../modules/docs/pages/MyDocsPage'))
export const DocsSharedPage = lazy(() => import('../modules/docs/pages/SharedWithMePage'))
export const DocsPrivatePage = lazy(() => import('../modules/docs/pages/PrivateDocsPage'))
export const DocsWikisPage = lazy(() => import('../modules/docs/pages/WikisPage'))
export const DocsMeetingNotesPage = lazy(() => import('../modules/docs/pages/MeetingNotesPage'))

// Home shortcuts (config-driven; see constants/homeItems.ts)
export const AssignedCommentsPage = lazy(() => import('../pages/app/AssignedCommentsPage'))
export const AllTasksPage = lazy(() => import('../pages/app/AllTasksPage'))
export const AllSpacesPage = lazy(() => import('../pages/app/AllSpacesPage'))
export const AllChannelsPage = lazy(() => import('../pages/app/AllChannelsPage'))

// Platform admin
export const PlatformAdminPage = lazy(() => import('../pages/admin/PlatformAdminPage'))
export const OrganizationsAdminPage = lazy(() => import('../pages/admin/OrganizationsAdminPage'))
