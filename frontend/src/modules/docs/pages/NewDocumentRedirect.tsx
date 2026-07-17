import { useEffect, useRef } from 'react'
import { Loader2 } from 'lucide-react'
import { useNavigate, useSearchParams } from 'react-router-dom'

import { useDocs } from '../context/DocsContext'

/**
 * `/app/docs/new` — creates a blank document (optionally in `?folder=<id>`) and
 * replaces the history entry with the editor route so Back doesn't re-trigger it.
 */
export default function NewDocumentRedirect() {
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const { createDocument } = useDocs()
  const created = useRef(false)

  useEffect(() => {
    if (created.current) return
    created.current = true
    void createDocument({ folderId: params.get('folder') }).then((doc) => {
      navigate(`/app/docs/${doc.id}`, { replace: true })
    })
  }, [createDocument, navigate, params])

  return (
    <div className="flex h-full items-center justify-center text-fg-muted">
      <Loader2 size={18} className="animate-spin" />
    </div>
  )
}
