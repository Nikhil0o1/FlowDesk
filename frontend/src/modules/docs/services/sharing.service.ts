import type { DocShareState } from '../types/permissions'

export function collaboratorCount(share: DocShareState | undefined): number {
  return share?.members.length ?? 0
}

export function copyShareLink(share: DocShareState | undefined): string {
  if (!share?.publicEnabled || !share.publicUrl) return ''
  return share.publicUrl
}

export function privateDocLink(documentId: string): string {
  return `${window.location.origin}/app/docs/${documentId}`
}
