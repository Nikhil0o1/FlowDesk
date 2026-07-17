/** A document template. Built-ins ship in `constants/templates`; custom ones (future). */
export interface DocTemplate {
  id: string
  name: string
  description: string
  category: string
  /** Seed HTML content, in the same format the editor reads/writes. */
  content: string
  /** Built-ins are read-only; custom templates (Phase 3) will set this false. */
  builtIn: boolean
}
