import { FileText } from 'lucide-react'

import { ScopedDocsPage } from './ScopedDocsPage'

export default function MyDocsPage() {
  return (
    <ScopedDocsPage
      scope="mine"
      title="My Docs"
      emptyIcon={FileText}
      emptyTitle="You haven't created any docs yet."
      emptyDescription="Documents you create will appear here."
    />
  )
}
