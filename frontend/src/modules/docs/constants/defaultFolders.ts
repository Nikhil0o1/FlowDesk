import type { Folder } from '../types/folder'

const now = '2026-06-01T09:00:00.000Z'

/**
 * Seed folder hierarchy used until a backend exists. Ids are stable so the
 * seeded documents can reference them. Supports nesting (Backend/Frontend live
 * under Engineering).
 */
export const DEFAULT_FOLDERS: Folder[] = [
  { id: 'f-engineering', name: 'Engineering', parentId: null, createdAt: now, updatedAt: now },
  { id: 'f-backend', name: 'Backend', parentId: 'f-engineering', createdAt: now, updatedAt: now },
  { id: 'f-frontend', name: 'Frontend', parentId: 'f-engineering', createdAt: now, updatedAt: now },
  { id: 'f-product', name: 'Product', parentId: null, createdAt: now, updatedAt: now },
  { id: 'f-marketing', name: 'Marketing', parentId: null, createdAt: now, updatedAt: now },
  { id: 'f-hr', name: 'HR', parentId: null, createdAt: now, updatedAt: now },
  { id: 'f-design', name: 'Design', parentId: null, createdAt: now, updatedAt: now },
]
