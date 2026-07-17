import { ListTree } from 'lucide-react'

interface SubtaskIconProps {
  size?: number
  className?: string
}

/** Hierarchical list glyph for subtasks (distinct from GitBranch / sprint icons). */
export function SubtaskIcon({ size = 14, className }: SubtaskIconProps) {
  return <ListTree size={size} className={className} aria-hidden />
}
