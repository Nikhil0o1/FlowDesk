/** Anchor for an inline comment tied to a text selection in the editor. */
export interface InlineAnchor {
  /** Stable id embedded in `<mark data-doc-comment="…">` in document HTML. */
  markerId: string
  /** Selected text snapshot for display when content drifts. */
  quote: string
}

export interface DocComment {
  id: string
  documentId: string
  authorId: string
  authorName: string
  body: string
  parentId: string | null
  /** General discussion vs inline — inline comments carry an anchor. */
  inlineAnchor: InlineAnchor | null
  resolved: boolean
  createdAt: string
  updatedAt: string
}
