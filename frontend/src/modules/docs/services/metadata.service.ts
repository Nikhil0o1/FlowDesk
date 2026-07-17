import type { FlowDoc } from '../types/document'
import { plainText } from './docs.service'

const WORDS_PER_MINUTE = 200

/** Number of words in a document's rendered text. */
export function wordCount(html: string): number {
  const text = plainText(html).trim()
  if (!text) return 0
  return text.split(/\s+/).length
}

/** Number of visible characters (whitespace-collapsed) in a document. */
export function charCount(html: string): number {
  return plainText(html).replace(/\s+/g, ' ').trim().length
}

/** Estimated reading time in whole minutes (min 1 when there is any text). */
export function readingMinutes(html: string): number {
  const words = wordCount(html)
  if (words === 0) return 0
  return Math.max(1, Math.round(words / WORDS_PER_MINUTE))
}

/** Human label for reading time, e.g. "3 min read". */
export function readingTimeLabel(html: string): string {
  const mins = readingMinutes(html)
  if (mins === 0) return '—'
  return `${mins} min read`
}

export interface DocMetadata {
  wordCount: number
  charCount: number
  readingMinutes: number
  readingLabel: string
}

/** Computes all content-derived metadata for a document in one pass. */
export function computeMetadata(doc: FlowDoc): DocMetadata {
  return {
    wordCount: wordCount(doc.content),
    charCount: charCount(doc.content),
    readingMinutes: readingMinutes(doc.content),
    readingLabel: readingTimeLabel(doc.content),
  }
}
