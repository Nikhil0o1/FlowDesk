import { useState } from 'react'

import { cn } from '../../../../lib/utils'
import { coverPresetClass } from '../../constants/coverPresets'
import { CoverPickerModal } from './CoverPickerModal'

interface DocCoverBannerProps {
  coverUrl?: string | null
  showCover: boolean
  onCoverChange: (url: string | null) => void
  readOnly?: boolean
}

/** Document cover banner — shown only when a cover image is set. */
export function DocCoverBanner({ coverUrl, showCover, onCoverChange, readOnly }: DocCoverBannerProps) {
  const [pickerOpen, setPickerOpen] = useState(false)
  const presetClass = coverPresetClass(coverUrl)
  const hasCover = !!coverUrl && showCover

  if (!hasCover) return null

  return (
    <>
      <div className="group relative w-full">
        <div className="relative h-44 w-full overflow-hidden">
          {presetClass ? (
            <div className={cn('h-full w-full', presetClass)} />
          ) : (
            <img src={coverUrl!} alt="" className="h-full w-full object-cover" />
          )}
          {!readOnly && (
            <div className="absolute bottom-3 right-4 flex gap-2 opacity-0 transition-opacity group-hover:opacity-100">
              <button
                type="button"
                onClick={() => setPickerOpen(true)}
                className="rounded-full bg-black/50 px-3 py-1 text-xs font-medium text-white backdrop-blur hover:bg-black/70"
              >
                Change cover
              </button>
            </div>
          )}
        </div>
      </div>

      <CoverPickerModal
        open={pickerOpen}
        onClose={() => setPickerOpen(false)}
        currentCover={coverUrl}
        onSelect={onCoverChange}
        readOnly={readOnly}
      />
    </>
  )
}
