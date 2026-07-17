export type DocFontStyle = 'system' | 'serif' | 'mono'
export type DocFontSize = 'small' | 'default' | 'large'
export type DocPageWidth = 'default' | 'full'
export type SubpagesView = 'table' | 'list' | 'cards'
export type RelationshipsView = 'dialog' | 'inline'
export type DocInsertBlock = 'table' | 'column' | 'list' | 'subpage'

export interface DocPageSettings {
  fontStyle: DocFontStyle
  fontSize: DocFontSize
  pageWidth: DocPageWidth
  showCover: boolean
  headerEnabled: boolean
  showPageIcon: boolean
  showOwners: boolean
  showContributors: boolean
  showSubtitle: boolean
  showLastModified: boolean
  subtitle: string
  subpagesView: SubpagesView
  relationshipsView: RelationshipsView
  showPageOutline: boolean
  focusBlock: boolean
  focusPage: boolean
  showStatsOnPage: boolean
}

export const DEFAULT_PAGE_SETTINGS: DocPageSettings = {
  fontStyle: 'system',
  fontSize: 'default',
  pageWidth: 'default',
  showCover: true,
  headerEnabled: false,
  showPageIcon: true,
  showOwners: true,
  showContributors: false,
  showSubtitle: false,
  showLastModified: true,
  subtitle: '',
  subpagesView: 'table',
  relationshipsView: 'dialog',
  showPageOutline: false,
  focusBlock: false,
  focusPage: false,
  showStatsOnPage: false,
}
