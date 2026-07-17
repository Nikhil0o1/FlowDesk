import type { DocComment } from '../types/comment'

/** Comments for a document, excluding replies (top-level only). */
export function topLevelComments(comments: DocComment[], documentId: string): DocComment[] {
  return comments.filter((c) => c.documentId === documentId && !c.parentId)
}

/** Direct replies to a comment. */
export function repliesTo(comments: DocComment[], parentId: string): DocComment[] {
  return comments.filter((c) => c.parentId === parentId)
}

/** Inline (anchored) comments for a document. */
export function inlineComments(comments: DocComment[], documentId: string): DocComment[] {
  return comments.filter((c) => c.documentId === documentId && c.inlineAnchor)
}

export function commentCount(comments: DocComment[], documentId: string): number {
  return comments.filter((c) => c.documentId === documentId).length
}

export function unresolvedCount(comments: DocComment[], documentId: string): number {
  return comments.filter((c) => c.documentId === documentId && !c.resolved && !c.parentId).length
}

/** Sort threads: newest or oldest first. */
export function sortThreads(threads: DocComment[], order: 'newest' | 'oldest'): DocComment[] {
  const copy = [...threads]
  copy.sort((a, b) =>
    order === 'newest' ? b.createdAt.localeCompare(a.createdAt) : a.createdAt.localeCompare(b.createdAt),
  )
  return copy
}
