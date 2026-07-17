import type { DocVersion } from '../types/version'

/** Versions for one document, newest first. */
export function versionsForDoc(versions: DocVersion[], documentId: string): DocVersion[] {
  return versions
    .filter((v) => v.documentId === documentId)
    .sort((a, b) => b.versionNumber - a.versionNumber)
}

export function latestVersion(versions: DocVersion[], documentId: string): DocVersion | undefined {
  return versionsForDoc(versions, documentId)[0]
}
