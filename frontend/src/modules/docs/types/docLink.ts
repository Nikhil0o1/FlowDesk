export type DocLinkTargetType = 'task' | 'document'

export interface DocLink {
  id: string
  targetType: DocLinkTargetType
  targetId: string
  title: string
  subtitle?: string
  icon?: string | null
  href: string
}
