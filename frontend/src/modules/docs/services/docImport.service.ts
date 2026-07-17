import { queryClient } from '../../../lib/queryClient'
import type { FlowDoc } from '../types/document'
import { importFileAsDoc } from './docExport.service'
import { docsKeys, importDocumentApi } from './docsApi.service'

/** Parse a local file and create a workspace Doc via the import API. */
export async function importFileToWorkspace(
  workspaceId: string,
  file: File,
  folderId: string | null = null,
): Promise<FlowDoc> {
  const { title, content, format } = await importFileAsDoc(file)
  const doc = await importDocumentApi(workspaceId, {
    title,
    content,
    folderId,
    format,
  })
  queryClient.setQueryData(docsKeys.document(doc.id), doc)
  void queryClient.invalidateQueries({ queryKey: docsKeys.all })
  return doc
}
