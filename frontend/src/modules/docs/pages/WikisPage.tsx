import { BookOpen } from 'lucide-react'

import { ScopedDocsPage } from './ScopedDocsPage'

export default function WikisPage() {
  return (
    <ScopedDocsPage
      scope="all"
      isWiki
      title="Wikis"
      emptyIcon={BookOpen}
      emptyTitle="No wikis yet."
      emptyDescription="Create a Wiki to organize knowledge in one place."
    />
  )
}
