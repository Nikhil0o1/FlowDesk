import { Users } from 'lucide-react'

import { ScopedDocsPage } from './ScopedDocsPage'

export default function SharedWithMePage() {
  return (
    <ScopedDocsPage
      scope="shared"
      title="Shared with me"
      emptyIcon={Users}
      emptyTitle="Nothing shared with you yet."
      emptyDescription="Docs other people share with you will appear here."
    />
  )
}
