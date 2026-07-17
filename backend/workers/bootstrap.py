"""Register every SQLAlchemy model before worker DB access.

Worker jobs import only the models they need. Without loading the full model
graph, SQLAlchemy cannot resolve foreign keys (e.g. invites.workspace_id →
workspaces.id) and commits fail with NoReferencedTableError.
"""
import app.db.base  # noqa: F401
