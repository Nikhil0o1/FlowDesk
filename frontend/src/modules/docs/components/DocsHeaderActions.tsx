import { ImportDocButton } from './ImportDocButton'
import { NewDocMenu } from './NewDocMenu'

interface DocsHeaderActionsProps {
  folderId?: string | null
}

/** Top-right header actions: Import + New Doc (ClickUp layout). */
export function DocsHeaderActions({ folderId = null }: DocsHeaderActionsProps) {
  return (
    <div className="flex shrink-0 items-center gap-2">
      <ImportDocButton folderId={folderId} />
      <NewDocMenu folderId={folderId} />
    </div>
  )
}
