import { FilterPanel } from './Filters/FilterPanel'
import { TagsFilter } from './Filters/TagsFilter'
import { SortMenu } from './Sorting/SortMenu'
import { SearchBox } from './Search/SearchBox'
import type { FlowDoc } from '../types/document'

interface DocsToolbarProps {
  docs: FlowDoc[]
  search?: string
  onSearchChange?: (value: string) => void
  searchPlaceholder?: string
}

/** ClickUp-style toolbar: Filters, Sort, Tags, Search. */
export function DocsToolbar({ docs, search = '', onSearchChange, searchPlaceholder = 'Search' }: DocsToolbarProps) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <FilterPanel docs={docs} />
      <SortMenu />
      <TagsFilter docs={docs} />
      {onSearchChange && (
        <div className="ml-auto w-full sm:w-auto">
          <SearchBox
            value={search}
            onChange={onSearchChange}
            placeholder={searchPlaceholder}
            ariaLabel="Search documents"
            className="w-full sm:w-44"
          />
        </div>
      )}
    </div>
  )
}
