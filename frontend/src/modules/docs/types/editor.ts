/** Auto-save lifecycle shown next to the document title. */
export type SaveStatus = 'idle' | 'saving' | 'saved' | 'unsaved'

/** Center-panel presentation of the document list. */
export type DocView = 'grid' | 'list'

/** Which collection a document card is rendered in — drives its actions. */
export type DocCardContext = 'active' | 'archive' | 'trash'

/** ClickUp-style document list sort keys. */
export type DocSort = 'created' | 'updated' | 'viewed' | 'title' | 'views' | 'oldest'

export type DocTriFilter = 'all' | 'yes' | 'no'

export type DocDateFilter = 'all' | 'week' | 'month'

export interface DocFilters {
  includeArchived: boolean
  status: 'all' | 'draft' | 'published'
  favorite: DocTriFilter
  author: string
  date: DocDateFilter
  template: DocTriFilter
}

export const DEFAULT_DOC_FILTERS: DocFilters = {
  includeArchived: false,
  status: 'all',
  favorite: 'all',
  author: '',
  date: 'all',
  template: 'all',
}

export type DocSortDir = 'asc' | 'desc'

/** ClickUp filter fields available in the "+ Add filter" menu. */
export type DocFilterField =
  | 'title'
  | 'location'
  | 'tag'
  | 'owner'
  | 'dateViewed'
  | 'dateUpdated'
  | 'dateCreated'
  | 'contributors'
  | 'sharing'
  | 'wiki'

export type DocFilterOperator =
  | 'contains'
  | 'equals'
  | 'not_equals'
  | 'before'
  | 'after'
  | 'on'
  | 'is'
  | 'is_not'

export interface DocFilterRule {
  id: string
  field: DocFilterField
  operator: DocFilterOperator
  value: string
}

export const DOC_FILTER_FIELDS: { id: DocFilterField; label: string }[] = [
  { id: 'title', label: 'Title' },
  { id: 'location', label: 'Location' },
  { id: 'tag', label: 'Tag' },
  { id: 'owner', label: 'Owner' },
  { id: 'dateViewed', label: 'Date viewed' },
  { id: 'dateUpdated', label: 'Date updated' },
  { id: 'dateCreated', label: 'Date created' },
  { id: 'contributors', label: 'Contributors' },
  { id: 'sharing', label: 'Sharing' },
  { id: 'wiki', label: 'Wiki' },
]

export const DEFAULT_FILTER_OPERATOR: Record<DocFilterField, DocFilterOperator> = {
  title: 'contains',
  location: 'is',
  tag: 'contains',
  owner: 'is',
  dateViewed: 'after',
  dateUpdated: 'after',
  dateCreated: 'after',
  contributors: 'is',
  sharing: 'is',
  wiki: 'is',
}

/** ClickUp-style Docs table columns (visibility toggled via header "+"). */
export type DocTableColumnId =
  | 'name'
  | 'location'
  | 'tags'
  | 'owner'
  | 'dateViewed'
  | 'dateCreated'
  | 'dateUpdated'
  | 'contributors'
  | 'sharing'

export interface DocTableColumnDef {
  id: DocTableColumnId
  label: string
  /** When true, the column cannot be hidden (Name). */
  locked?: boolean
}

export const DOC_TABLE_COLUMNS: readonly DocTableColumnDef[] = [
  { id: 'name', label: 'Name', locked: true },
  { id: 'location', label: 'Location' },
  { id: 'tags', label: 'Tags' },
  { id: 'owner', label: 'Owner' },
  { id: 'dateViewed', label: 'Date viewed' },
  { id: 'dateCreated', label: 'Date created' },
  { id: 'dateUpdated', label: 'Date updated' },
  { id: 'contributors', label: 'Contributors' },
  { id: 'sharing', label: 'Sharing' },
] as const

/** Matches the hard-coded columns that shipped before the Columns picker. */
export const DEFAULT_VISIBLE_DOC_COLUMNS: DocTableColumnId[] = [
  'name',
  'location',
  'tags',
  'dateUpdated',
  'dateViewed',
  'sharing',
]

export type DocBannerVariant =
  | 'info'
  | 'tip'
  | 'warning'
  | 'danger'
  | 'orange'
  | 'yellow'
  | 'purple'
  | 'pink'
  | 'gray'
  | 'teal'

/** Solid vs pastel callout intensity (matches ClickUp-style banner picker). */
export type DocBannerTone = 'solid' | 'soft'

export type DocToolbarPosition = 'floating' | 'top'

/** Formatting commands the toolbar invokes on the editor. */
export interface EditorApi {
  undo: () => void
  redo: () => void
  paragraph: () => void
  heading: (level: 1 | 2 | 3 | 4) => void
  bold: () => void
  italic: () => void
  underline: () => void
  strike: () => void
  bulletList: () => void
  numberList: () => void
  checklist: () => void
  quote: () => void
  /** Wrap the current block in a colored callout/banner. */
  banner: (variant: DocBannerVariant, tone?: DocBannerTone) => void
  inlineCode: () => void
  codeBlock: () => void
  link: () => void
  image: () => void
  table: () => void
  divider: () => void
  columns: () => void
  taskList: () => void
  subpage: (documentId: string, title: string) => void
  /** Apply text color to the current selection (`execCommand foreColor`). */
  foreColor: (color: string) => void
  /** Apply background highlight to the current selection. */
  hiliteColor: (color: string) => void
  /** Wrap selection in a solid color badge chip. */
  badge: (color: string) => void
  /** Strip text color / highlight / badge from the selection. */
  removeColor: () => void
  /** Align the current block(s). */
  align: (value: 'left' | 'center' | 'right' | 'justify') => void
  indent: () => void
  outdent: () => void
  /** Strip inline formatting from the selection. */
  clearFormat: () => void
  focus: () => void
  insertAt: () => void
  /** Apply HTML from a remote peer without remounting (keeps local focus when possible). */
  applyRemoteContent: (html: string) => void
  getCaretOffset: () => number
}
