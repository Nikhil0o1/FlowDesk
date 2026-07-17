import { Lock } from 'lucide-react'

import { ScopedDocsPage } from './ScopedDocsPage'

export default function PrivateDocsPage() {
  return (
    <ScopedDocsPage
      scope="private"
      title="Private"
      emptyIcon={Lock}
      emptyTitle="No private docs."
      emptyDescription="Docs only you can see (not shared) appear here."
    />
  )
}
