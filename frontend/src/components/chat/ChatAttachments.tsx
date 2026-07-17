import { Download, FileText, Music } from 'lucide-react'
import { useEffect, useState } from 'react'

import { api, errorMessage } from '../../lib/api'
import type { ChatAttachment } from '../../lib/types'
import { formatBytes } from '../../lib/utils'
import { toast } from '../../stores/toast'

async function fetchBlob(attachment: ChatAttachment): Promise<Blob> {
  return api.get<Blob>(`/chat-attachments/${attachment.id}/download`)
}

async function downloadAttachment(attachment: ChatAttachment) {
  try {
    const blob = await fetchBlob(attachment)
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = attachment.file_name
    anchor.click()
    URL.revokeObjectURL(url)
  } catch (err) {
    toast.error(errorMessage(err))
  }
}

async function openPdfPreview(attachment: ChatAttachment) {
  try {
    const blob = await fetchBlob(attachment)
    // Force the pdf type so the browser opens its viewer instead of downloading.
    const url = URL.createObjectURL(blob.slice(0, blob.size, 'application/pdf'))
    window.open(url, '_blank', 'noopener')
    window.setTimeout(() => URL.revokeObjectURL(url), 60_000)
  } catch (err) {
    toast.error(errorMessage(err))
  }
}

/** Fetch the file with auth and expose it as an object URL (plain src can't send the bearer token). */
function useAttachmentUrl(attachment: ChatAttachment) {
  const [url, setUrl] = useState<string | null>(null)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    let objectUrl: string | null = null
    let cancelled = false
    void fetchBlob(attachment)
      .then((blob) => {
        if (cancelled) return
        objectUrl = URL.createObjectURL(blob)
        setUrl(objectUrl)
      })
      .catch(() => setFailed(true))
    return () => {
      cancelled = true
      if (objectUrl) URL.revokeObjectURL(objectUrl)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [attachment.id])

  return { url, failed }
}

function ImageAttachment({ attachment }: { attachment: ChatAttachment }) {
  const { url, failed } = useAttachmentUrl(attachment)
  if (failed) return <FileChip attachment={attachment} />
  if (!url) {
    return <div className="h-40 w-56 animate-pulse rounded-xl bg-ink-800" aria-label="Loading image" />
  }
  return (
    <button
      type="button"
      onClick={() => void downloadAttachment(attachment)}
      title={`${attachment.file_name} · ${formatBytes(attachment.size_bytes)} — click to download`}
      className="block overflow-hidden rounded-xl border border-ink-700 transition-opacity hover:opacity-90"
    >
      <img src={url} alt={attachment.file_name} className="max-h-56 max-w-[320px] object-contain" />
    </button>
  )
}

function VideoAttachment({ attachment }: { attachment: ChatAttachment }) {
  const { url, failed } = useAttachmentUrl(attachment)
  if (failed) return <FileChip attachment={attachment} />
  if (!url) {
    return <div className="h-40 w-64 animate-pulse rounded-xl bg-ink-800" aria-label="Loading video" />
  }
  return (
    <div className="overflow-hidden rounded-xl border border-ink-700">
      <video src={url} controls preload="metadata" className="max-h-64 max-w-[380px]">
        <track kind="captions" />
      </video>
    </div>
  )
}

function AudioAttachment({ attachment }: { attachment: ChatAttachment }) {
  const { url, failed } = useAttachmentUrl(attachment)
  if (failed) return <FileChip attachment={attachment} />
  return (
    <div className="flex w-[300px] flex-col gap-1 rounded-xl border border-ink-700 bg-ink-800/60 px-3 py-2">
      <span className="flex items-center gap-1.5 truncate text-xs font-medium text-fg">
        <Music size={13} className="shrink-0 text-fg-muted" />
        {attachment.file_name}
      </span>
      {url ? (
        <audio src={url} controls preload="metadata" className="h-9 w-full">
          <track kind="captions" />
        </audio>
      ) : (
        <div className="h-9 w-full animate-pulse rounded-lg bg-ink-800" aria-label="Loading audio" />
      )}
    </div>
  )
}

function FileChip({ attachment }: { attachment: ChatAttachment }) {
  const isPdf =
    attachment.mime_type === 'application/pdf' || attachment.file_name.toLowerCase().endsWith('.pdf')
  return (
    <span className="group flex max-w-[320px] items-center gap-2.5 rounded-xl border border-ink-700 bg-ink-800/60 px-3 py-2 transition-colors hover:border-ink-600 hover:bg-ink-800">
      <button
        type="button"
        title={isPdf ? 'Preview PDF' : 'Download'}
        onClick={() => void (isPdf ? openPdfPreview(attachment) : downloadAttachment(attachment))}
        className="flex min-w-0 flex-1 items-center gap-2.5 text-left"
      >
        <FileText size={18} className="shrink-0 text-fg-muted" />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-xs font-medium text-fg">{attachment.file_name}</span>
          <span className="block text-[10px] text-fg-muted">
            {formatBytes(attachment.size_bytes)}
            {isPdf && ' · click to preview'}
          </span>
        </span>
      </button>
      <button
        type="button"
        title="Download"
        onClick={() => void downloadAttachment(attachment)}
        className="shrink-0 rounded p-1 text-fg-muted/50 transition-colors hover:bg-ink-750 hover:text-fg"
      >
        <Download size={14} />
      </button>
    </span>
  )
}

export function MessageAttachments({ attachments }: { attachments: ChatAttachment[] }) {
  if (attachments.length === 0) return null
  return (
    <div className="mt-1.5 flex flex-wrap gap-2">
      {attachments.map((attachment) => {
        const mime = attachment.mime_type
        if (mime.startsWith('image/')) return <ImageAttachment key={attachment.id} attachment={attachment} />
        if (mime.startsWith('video/')) return <VideoAttachment key={attachment.id} attachment={attachment} />
        if (mime.startsWith('audio/')) return <AudioAttachment key={attachment.id} attachment={attachment} />
        return <FileChip key={attachment.id} attachment={attachment} />
      })}
    </div>
  )
}
