from fastapi import APIRouter

from app.api.v1 import (
    admin,
    attachments,
    auth,
    calendar,
    chat,
    comments,
    forms,
    github,
    integrations,
    notifications,
    organizations,
    projects,
    search,
    sprints,
    tasks,
    teams,
    time_entries,
    users,
    whiteboards,
    workspaces,
    ws,
)

api_router = APIRouter(prefix="/api/v1")
api_router.include_router(auth.router)
api_router.include_router(users.router)
api_router.include_router(organizations.router)
api_router.include_router(workspaces.router)
api_router.include_router(projects.router)
api_router.include_router(tasks.router)
api_router.include_router(comments.router)
api_router.include_router(notifications.router)
api_router.include_router(chat.router)
api_router.include_router(time_entries.router)
api_router.include_router(sprints.router)
api_router.include_router(github.router)
api_router.include_router(teams.router)
api_router.include_router(whiteboards.router)
api_router.include_router(forms.router)
api_router.include_router(calendar.router)
api_router.include_router(integrations.router)
api_router.include_router(attachments.router)
api_router.include_router(search.router)
api_router.include_router(admin.router)
api_router.include_router(ws.router)
