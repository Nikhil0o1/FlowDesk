import { useRef, useState } from 'react'
import { Image, Link2, Upload, X } from 'lucide-react'

import { Modal } from '../../../../components/ui/Modal'
import { cn } from '../../../../lib/utils'
import { COVER_PRESETS } from '../../constants/coverPresets'

type CoverTab = 'gallery' | 'upload' | 'link'

interface CoverPickerModalProps {
  open: boolean
  onClose: () => void
  currentCover?: string | null
  onSelect: (coverUrl: string | null) => void
  readOnly?: boolean
}

/** ClickUp-style cover picker: presets, upload, or external link. */
export function CoverPickerModal({ open, onClose, currentCover, onSelect, readOnly }: CoverPickerModalProps) {
  const [tab, setTab] = useState<CoverTab>('gallery')
  const [linkUrl, setLinkUrl] = useState('')
  const fileRef = useRef<HTMLInputElement>(null)

  const apply = (url: string | null) => {
    if (readOnly) return
    onSelect(url)
    onClose()
  }

  const onFile = (file: File) => {
    if (readOnly || !file.type.startsWith('image/')) return
    const reader = new FileReader()
    reader.onload = () => {
      if (typeof reader.result === 'string') apply(reader.result)
    }
    reader.readAsDataURL(file)
  }

  const tabs: { id: CoverTab; label: string; icon: typeof Image }[] = [
    { id: 'gallery', label: 'Gallery', icon: Image },
    { id: 'upload', label: 'Upload', icon: Upload },
    { id: 'link', label: 'Link', icon: Link2 },
  ]

  return (
    <Modal open={open} onClose={onClose} width="max-w-md">
      <div className="-m-5 flex flex-col">
        <div className="flex items-center justify-between border-b border-ink-700 px-5 py-3">
          <div className="flex gap-4">
            {tabs.map(({ id, label }) => (
              <button
                key={id}
                type="button"
                onClick={() => setTab(id)}
                className={cn(
                  'border-b-2 pb-2 text-sm font-medium transition-colors',
                  tab === id ? 'border-brand text-fg' : 'border-transparent text-fg-muted hover:text-fg',
                )}
              >
                {label}
              </button>
            ))}
          </div>
          {currentCover && !readOnly && (
            <button
              type="button"
              onClick={() => apply(null)}
              className="text-xs font-medium text-red-400 hover:text-red-300"
            >
              Remove
            </button>
          )}
        </div>

        <div className="max-h-[360px] overflow-y-auto p-5">
          {tab === 'gallery' && (
            <>
              <p className="mb-3 text-xs font-medium text-fg-muted">Colors</p>
              <div className="grid grid-cols-4 gap-2">
                {COVER_PRESETS.map((preset) => (
                  <button
                    key={preset.id}
                    type="button"
                    disabled={readOnly}
                    title={preset.label}
                    onClick={() => apply(preset.id)}
                    className={cn(
                      'aspect-[4/3] rounded-lg border-2 transition-transform hover:scale-[1.02]',
                      preset.className,
                      currentCover === preset.id ? 'border-white ring-2 ring-brand' : 'border-transparent',
                    )}
                  />
                ))}
              </div>
            </>
          )}

          {tab === 'upload' && (
            <div className="flex flex-col items-center gap-3 py-8">
              <input
                ref={fileRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0]
                  if (f) onFile(f)
                  e.target.value = ''
                }}
              />
              <button
                type="button"
                disabled={readOnly}
                onClick={() => fileRef.current?.click()}
                className="flex items-center gap-2 rounded-lg border border-dashed border-ink-600 bg-ink-800 px-4 py-3 text-sm text-fg-secondary hover:border-brand hover:text-fg disabled:opacity-50"
              >
                <Upload size={16} />
                Choose an image
              </button>
              <p className="text-xs text-fg-muted">PNG, JPG, or GIF up to 5 MB</p>
            </div>
          )}

          {tab === 'link' && (
            <div className="space-y-3">
              <input
                value={linkUrl}
                onChange={(e) => setLinkUrl(e.target.value)}
                placeholder="Paste image URL…"
                disabled={readOnly}
                className="w-full rounded-lg border border-ink-700 bg-ink-800 px-3 py-2 text-sm text-fg outline-none focus:border-brand disabled:opacity-50"
              />
              <button
                type="button"
                disabled={readOnly || !linkUrl.trim().startsWith('http')}
                onClick={() => apply(linkUrl.trim())}
                className="btn-primary w-full disabled:opacity-50"
              >
                Apply link
              </button>
            </div>
          )}
        </div>

        <div className="flex justify-end border-t border-ink-700 px-5 py-3">
          <button type="button" onClick={onClose} className="rounded-lg px-3 py-1.5 text-sm text-fg-muted hover:text-fg">
            <X size={14} className="inline" /> Close
          </button>
        </div>
      </div>
    </Modal>
  )
}
