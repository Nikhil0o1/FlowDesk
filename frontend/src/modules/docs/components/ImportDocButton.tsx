import { useRef, useState } from 'react'
import { Loader2, Upload } from 'lucide-react'
import { useNavigate } from 'react-router-dom'

import { useCurrentContext } from '../../../lib/queries'
import { ApiError } from '../../../lib/api'
import { toast } from '../../../stores/toast'
import { importFileToWorkspace } from '../services/docImport.service'

interface ImportDocButtonProps {
  folderId?: string | null
}

/** Standalone Import button (ClickUp header). Creates a new Doc from a file. */
export function ImportDocButton({ folderId = null }: ImportDocButtonProps) {
  const navigate = useNavigate()
  const { workspace } = useCurrentContext()
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState(false)

  const onImportFile = async (file: File | undefined) => {
    if (!file || !workspace?.id || busy) return
    setBusy(true)
    try {
      const doc = await importFileToWorkspace(workspace.id, file, folderId)
      toast.success('Document imported')
      navigate(`/app/docs/${doc.id}`)
    } catch (err) {
      const message =
        err instanceof ApiError
          ? typeof err.detail === 'string'
            ? err.detail
            : err.message
          : err instanceof Error
            ? err.message
            : 'Could not import that file'
      toast.error(message)
    } finally {
      setBusy(false)
      if (fileInputRef.current) fileInputRef.current.value = ''
    }
  }

  return (
    <>
      <button
        type="button"
        disabled={busy || !workspace?.id}
        onClick={() => fileInputRef.current?.click()}
        className="flex items-center gap-1.5 rounded-lg border border-ink-700 bg-ink-850 px-3 py-1.5 text-sm font-medium text-fg-secondary transition-colors hover:bg-ink-800 hover:text-fg disabled:opacity-50"
      >
        {busy ? <Loader2 size={15} className="animate-spin" /> : <Upload size={15} />}
        Import
      </button>
      <input
        ref={fileInputRef}
        type="file"
        accept=".md,.markdown,.txt,.text,.html,.htm,text/plain,text/markdown,text/html"
        className="hidden"
        onChange={(e) => {
          void onImportFile(e.target.files?.[0])
        }}
      />
    </>
  )
}
