import { Search } from 'lucide-react'

import { cn } from '../../lib/utils'

interface Props {
  value: string
  onChange: (value: string) => void
  placeholder?: string
  className?: string
}

/** Reusable search field with a leading icon, matching the FlowDesk input style. */
export function SearchInput({ value, onChange, placeholder = 'Search', className }: Props) {
  return (
    <div className={cn('relative', className)}>
      <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-fg-muted" />
      <input
        type="search"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        aria-label={placeholder}
        className="input-dark !pl-9"
      />
    </div>
  )
}
