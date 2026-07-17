import { useState } from 'react'
import {
  CheckCircle2,
  Circle,
  ImageIcon,
  Settings,
} from 'lucide-react'

import { cn } from '../../../../lib/utils'
import { CoverPickerModal } from './CoverPickerModal'
import { LinkTaskOrDocPicker } from './LinkTaskOrDocPicker'
import { PageIconPicker } from './PageIconPicker'

function ToolbarAction({
  icon: Icon,
  label,
  onClick,
  active,
  disabled,
}: {
  icon: typeof Settings
  label: string
  onClick?: () => void
  active?: boolean
  disabled?: boolean
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={cn(
        'flex items-center gap-1.5 rounded-md px-2 py-1 text-sm transition-colors disabled:opacity-50',
        active
          ? 'text-brand hover:text-brand'
          : 'text-fg-muted hover:bg-ink-800 hover:text-fg-secondary',
      )}
    >
      <Icon size={14} className="shrink-0" />
      <span>{label}</span>
    </button>
  )
}

interface DocPageToolbarProps {
  documentId: string
  readOnly?: boolean
  isWiki?: boolean
  onToggleWiki?: () => void
  docIcon?: string | null
  onIconChange: (icon: string | null) => void
  coverUrl?: string | null
  onCoverChange: (url: string | null) => void
  onOpenSettings: () => void
}

/** ClickUp-style horizontal action row above the document title (revealed on hover). */
export function DocPageToolbar({
  documentId,
  readOnly,
  isWiki,
  onToggleWiki,
  docIcon,
  onIconChange,
  coverUrl,
  onCoverChange,
  onOpenSettings,
}: DocPageToolbarProps) {
  return (
    <div className="flex flex-wrap items-center gap-1">
      <LinkTaskOrDocPicker documentId={documentId} readOnly={readOnly} showChips={false} variant="toolbar" />

      <div className="flex flex-wrap items-center gap-1 opacity-0 transition-opacity group-hover/pagehead:opacity-100 group-focus-within/pagehead:opacity-100">
        <ToolbarAction
          icon={isWiki ? CheckCircle2 : Circle}
          label="Mark Wiki"
          onClick={onToggleWiki}
          active={isWiki}
          disabled={readOnly || !onToggleWiki}
        />

        <PageIconPicker icon={docIcon} onChange={onIconChange} readOnly={readOnly} variant="toolbar" />

        <CoverPickerTrigger coverUrl={coverUrl} onCoverChange={onCoverChange} readOnly={readOnly} />

        <ToolbarAction icon={Settings} label="Settings" onClick={onOpenSettings} />
      </div>
    </div>
  )
}

function CoverPickerTrigger({
  coverUrl,
  onCoverChange,
  readOnly,
}: {
  coverUrl?: string | null
  onCoverChange: (url: string | null) => void
  readOnly?: boolean
}) {
  const [open, setOpen] = useState(false)
  return (
    <>
      <ToolbarAction
        icon={ImageIcon}
        label={coverUrl ? 'Change cover' : 'Add cover'}
        onClick={() => !readOnly && setOpen(true)}
        disabled={readOnly}
      />
      <CoverPickerModal
        open={open}
        onClose={() => setOpen(false)}
        currentCover={coverUrl}
        onSelect={onCoverChange}
        readOnly={readOnly}
      />
    </>
  )
}
