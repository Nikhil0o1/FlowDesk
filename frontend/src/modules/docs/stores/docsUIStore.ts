import { create } from 'zustand'
import { persist } from 'zustand/middleware'

import {
  DEFAULT_VISIBLE_DOC_COLUMNS,
  DOC_TABLE_COLUMNS,
  type DocFilterRule,
  type DocSort,
  type DocSortDir,
  type DocTableColumnId,
  type DocView,
} from '../types/editor'

const MAX_RECENT_SEARCHES = 8

const LOCKED_COLUMNS = new Set(
  DOC_TABLE_COLUMNS.filter((c) => c.locked).map((c) => c.id),
)

interface DocsUIState {
  search: string
  setSearch: (search: string) => void
  expanded: Record<string, boolean>
  toggleExpanded: (id: string) => void
  setExpanded: (id: string, open: boolean) => void
  view: DocView
  setView: (view: DocView) => void
  sort: DocSort
  sortDir: DocSortDir
  setSort: (sort: DocSort) => void
  setSortDir: (dir: DocSortDir) => void

  /** ClickUp-style additive filter rules. */
  filterRules: DocFilterRule[]
  addFilterRule: (rule: Omit<DocFilterRule, 'id'>) => void
  updateFilterRule: (id: string, patch: Partial<Omit<DocFilterRule, 'id'>>) => void
  removeFilterRule: (id: string) => void
  clearFilterRules: () => void

  /** Tag chips selected in the toolbar (AND filter). */
  tagFilter: string[]
  toggleTagFilter: (tag: string) => void
  clearTagFilter: () => void

  /** Visible Docs table columns (ClickUp Columns picker). Name is always kept. */
  visibleColumns: DocTableColumnId[]
  setColumnVisible: (id: DocTableColumnId, visible: boolean) => void
  toggleColumn: (id: DocTableColumnId) => void

  selectedIds: string[]
  toggleSelected: (id: string) => void
  setSelected: (ids: string[]) => void
  clearSelected: () => void

  recentSearches: string[]
  addRecentSearch: (q: string) => void
  clearRecentSearches: () => void
}

let nextFilterId = 1

export const useDocsUIStore = create<DocsUIState>()(
  persist(
    (set) => ({
      search: '',
      setSearch: (search) => set({ search }),
      expanded: {},
      toggleExpanded: (id) =>
        set((s) => ({ expanded: { ...s.expanded, [id]: !(s.expanded[id] ?? false) } })),
      setExpanded: (id, open) => set((s) => ({ expanded: { ...s.expanded, [id]: open } })),
      view: 'list',
      setView: (view) => set({ view }),
      sort: 'updated',
      sortDir: 'desc',
      setSort: (sort) => set({ sort }),
      setSortDir: (sortDir) => set({ sortDir }),

      filterRules: [],
      addFilterRule: (rule) =>
        set((s) => ({
          filterRules: [...s.filterRules, { ...rule, id: `f${nextFilterId++}` }],
        })),
      updateFilterRule: (id, patch) =>
        set((s) => ({
          filterRules: s.filterRules.map((r) => (r.id === id ? { ...r, ...patch } : r)),
        })),
      removeFilterRule: (id) => set((s) => ({ filterRules: s.filterRules.filter((r) => r.id !== id) })),
      clearFilterRules: () => set({ filterRules: [] }),

      tagFilter: [],
      toggleTagFilter: (tag) =>
        set((s) => ({
          tagFilter: s.tagFilter.includes(tag) ? s.tagFilter.filter((t) => t !== tag) : [...s.tagFilter, tag],
        })),
      clearTagFilter: () => set({ tagFilter: [] }),

      visibleColumns: [...DEFAULT_VISIBLE_DOC_COLUMNS],
      setColumnVisible: (id, visible) =>
        set((s) => {
          if (LOCKED_COLUMNS.has(id)) return s
          const has = s.visibleColumns.includes(id)
          if (visible && !has) {
            // Keep catalog order so toggled columns insert in ClickUp's order.
            const next = DOC_TABLE_COLUMNS.map((c) => c.id).filter(
              (col) => col === id || s.visibleColumns.includes(col),
            )
            return { visibleColumns: next }
          }
          if (!visible && has) {
            return { visibleColumns: s.visibleColumns.filter((c) => c !== id) }
          }
          return s
        }),
      toggleColumn: (id) =>
        set((s) => {
          if (LOCKED_COLUMNS.has(id)) return s
          const visible = !s.visibleColumns.includes(id)
          if (visible) {
            const next = DOC_TABLE_COLUMNS.map((c) => c.id).filter(
              (col) => col === id || s.visibleColumns.includes(col),
            )
            return { visibleColumns: next }
          }
          return { visibleColumns: s.visibleColumns.filter((c) => c !== id) }
        }),

      selectedIds: [],
      toggleSelected: (id) =>
        set((s) => ({
          selectedIds: s.selectedIds.includes(id)
            ? s.selectedIds.filter((x) => x !== id)
            : [...s.selectedIds, id],
        })),
      setSelected: (ids) => set({ selectedIds: ids }),
      clearSelected: () => set({ selectedIds: [] }),

      recentSearches: [],
      addRecentSearch: (q) =>
        set((s) => {
          const query = q.trim()
          if (!query) return s
          return {
            recentSearches: [query, ...s.recentSearches.filter((x) => x !== query)].slice(0, MAX_RECENT_SEARCHES),
          }
        }),
      clearRecentSearches: () => set({ recentSearches: [] }),
    }),
    {
      name: 'flowdesk-docs-ui-v2',
      partialize: (s) => ({
        expanded: s.expanded,
        view: s.view,
        sort: s.sort,
        sortDir: s.sortDir,
        filterRules: s.filterRules,
        tagFilter: s.tagFilter,
        visibleColumns: s.visibleColumns,
        recentSearches: s.recentSearches,
      }),
      merge: (persisted, current) => {
        const saved = persisted as Partial<DocsUIState> | undefined
        const known = new Set(DOC_TABLE_COLUMNS.map((c) => c.id))
        const fromSaved = (saved?.visibleColumns ?? []).filter((id): id is DocTableColumnId => known.has(id))
        const visibleColumns =
          fromSaved.length > 0
            ? DOC_TABLE_COLUMNS.map((c) => c.id).filter(
                (id) => LOCKED_COLUMNS.has(id) || fromSaved.includes(id),
              )
            : [...DEFAULT_VISIBLE_DOC_COLUMNS]
        return { ...current, ...saved, visibleColumns }
      },
    },
  ),
)
