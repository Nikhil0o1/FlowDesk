import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import {
  AlertCircle,
  AlertTriangle,
  Bell,
  Bookmark,
  BookmarkMinus,
  Bug,
  Calendar,
  Check,
  CheckCircle2,
  ChevronDown,
  CircleAlert,
  ClipboardList,
  Clock,
  Copy,
  FileText,
  Flag,
  Flame,
  Folder,
  Heart,
  HelpCircle,
  Home,
  Info,
  Lightbulb,
  Link2,
  type LucideIcon,
  ListTodo,
  Lock,
  Mail,
  Megaphone,
  MessageSquare,
  MoreHorizontal,
  Paperclip,
  Pin,
  Settings,
  Smile,
  Star,
  Target,
  ThumbsUp,
  Trash2,
  Users,
  Zap,
} from 'lucide-react'
import { createPortal } from 'react-dom'

import { EmojiPicker } from '../../../../components/chat/EmojiPicker'
import { cn } from '../../../../lib/utils'
import { toast } from '../../../../stores/toast'
import { copyBlockLink, deleteEditorBlock, duplicateEditorBlock, ensureBlockId } from './docEditorBlocks'

/** Banner swatches shown in Turn Into → Banners and banner color chrome. */
export const BANNER_PICKER_SWATCHES: {
  variant: string
  label: string
  color: string
  soft: string
}[] = [
  { variant: 'danger', label: 'Red', color: '#ef4444', soft: '#fca5a5' },
  { variant: 'orange', label: 'Orange', color: '#f97316', soft: '#fdba74' },
  { variant: 'yellow', label: 'Yellow', color: '#eab308', soft: '#fde047' },
  { variant: 'info', label: 'Blue', color: '#3b82f6', soft: '#93c5fd' },
  { variant: 'purple', label: 'Purple', color: '#a855f7', soft: '#d8b4fe' },
  { variant: 'pink', label: 'Pink', color: '#ec4899', soft: '#f9a8d4' },
  { variant: 'tip', label: 'Green', color: '#22c55e', soft: '#86efac' },
  { variant: 'gray', label: 'Gray', color: '#94a3b8', soft: '#cbd5e1' },
]

const BANNER_VARIANT_IDS = BANNER_PICKER_SWATCHES.map((s) => s.variant)

const BANNER_ICONS: { id: string; label: string; Icon: LucideIcon }[] = [
  { id: 'flag', label: 'Flag', Icon: Flag },
  { id: 'info', label: 'Info', Icon: Info },
  { id: 'alert', label: 'Alert', Icon: AlertCircle },
  { id: 'warning', label: 'Warning', Icon: AlertTriangle },
  { id: 'circle-alert', label: 'Important', Icon: CircleAlert },
  { id: 'check', label: 'Check', Icon: CheckCircle2 },
  { id: 'help', label: 'Help', Icon: HelpCircle },
  { id: 'lightbulb', label: 'Idea', Icon: Lightbulb },
  { id: 'star', label: 'Star', Icon: Star },
  { id: 'heart', label: 'Heart', Icon: Heart },
  { id: 'flame', label: 'Flame', Icon: Flame },
  { id: 'zap', label: 'Zap', Icon: Zap },
  { id: 'megaphone', label: 'Announcement', Icon: Megaphone },
  { id: 'pin', label: 'Pin', Icon: Pin },
  { id: 'bookmark', label: 'Bookmark', Icon: Bookmark },
  { id: 'smile', label: 'Smile', Icon: Smile },
  { id: 'bell', label: 'Bell', Icon: Bell },
  { id: 'clock', label: 'Clock', Icon: Clock },
  { id: 'calendar', label: 'Calendar', Icon: Calendar },
  { id: 'target', label: 'Target', Icon: Target },
  { id: 'thumbs-up', label: 'Thumbs up', Icon: ThumbsUp },
  { id: 'message', label: 'Message', Icon: MessageSquare },
  { id: 'users', label: 'People', Icon: Users },
  { id: 'home', label: 'Home', Icon: Home },
  { id: 'folder', label: 'Folder', Icon: Folder },
  { id: 'file', label: 'File', Icon: FileText },
  { id: 'clipboard', label: 'Clipboard', Icon: ClipboardList },
  { id: 'todo', label: 'Todo', Icon: ListTodo },
  { id: 'mail', label: 'Mail', Icon: Mail },
  { id: 'link', label: 'Link', Icon: Link2 },
  { id: 'paperclip', label: 'Attachment', Icon: Paperclip },
  { id: 'lock', label: 'Lock', Icon: Lock },
  { id: 'settings', label: 'Settings', Icon: Settings },
  { id: 'bug', label: 'Bug', Icon: Bug },
  { id: 'trash', label: 'Trash', Icon: Trash2 },
]

type PanelKind = 'emoji' | 'color' | 'more' | null
type IconTab = 'icon' | 'emoji'

interface DocBannerChromeProps {
  block: HTMLElement
  docId: string
  readOnly?: boolean
  onChange: () => void
  onClose: () => void
}

function clampPanel(anchor: DOMRect, panelW: number, panelH: number, preferUp = true) {
  const gap = 8
  const pad = 8
  const spaceBelow = window.innerHeight - anchor.bottom - gap - pad
  const spaceAbove = anchor.top - gap - pad
  const openUp = preferUp
    ? spaceAbove >= Math.min(panelH, 160) || spaceAbove > spaceBelow
    : spaceBelow < panelH && spaceAbove > spaceBelow
  const top = openUp
    ? Math.max(pad, anchor.top - gap - panelH)
    : Math.min(anchor.bottom + gap, window.innerHeight - panelH - pad)
  let left = anchor.left
  if (left + panelW > window.innerWidth - pad) left = window.innerWidth - panelW - pad
  left = Math.max(pad, left)
  return { top, left, maxHeight: Math.max(160, openUp ? spaceAbove : spaceBelow) }
}

function iconSvgMarkup(Icon: LucideIcon, color: string) {
  return renderToStaticMarkup(<Icon size={18} color={color} strokeWidth={2} />)
}

/** Floating toolbar for callout/banner blocks (icon, color, more). */
export function DocBannerChrome({ block, docId, readOnly, onChange, onClose }: DocBannerChromeProps) {
  const [rect, setRect] = useState<DOMRect | null>(null)
  const [panel, setPanel] = useState<PanelKind>(null)
  const [iconTab, setIconTab] = useState<IconTab>('icon')
  const [iconQuery, setIconQuery] = useState('')
  const [iconTint, setIconTint] = useState('#ec4899')
  const [panelPos, setPanelPos] = useState({ top: 0, left: 0, maxHeight: 320 })
  const toolbarRef = useRef<HTMLDivElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  const anchorRef = useRef<DOMRect | null>(null)

  const updateRect = useCallback(() => {
    setRect(block.getBoundingClientRect())
  }, [block])

  useEffect(() => {
    ensureBlockId(block)
    block.classList.add('doc-editor-block-active')
    updateRect()
    const onScroll = () => updateRect()
    window.addEventListener('scroll', onScroll, true)
    window.addEventListener('resize', onScroll)
    const obs = new ResizeObserver(() => updateRect())
    obs.observe(block)
    return () => {
      block.classList.remove('doc-editor-block-active')
      window.removeEventListener('scroll', onScroll, true)
      window.removeEventListener('resize', onScroll)
      obs.disconnect()
    }
  }, [block, updateRect])

  useEffect(() => {
    const tone = block.getAttribute('data-banner-tone') || 'solid'
    const variant = block.getAttribute('data-banner-variant') || 'info'
    const swatch = BANNER_PICKER_SWATCHES.find((s) => s.variant === variant)
    if (swatch) setIconTint(tone === 'soft' ? swatch.soft : swatch.color)
  }, [block])

  useLayoutEffect(() => {
    if (!panel || !anchorRef.current || !panelRef.current) return
    const el = panelRef.current
    const pos = clampPanel(
      anchorRef.current,
      el.offsetWidth || (panel === 'emoji' ? 340 : panel === 'color' ? 220 : 210),
      el.offsetHeight || 280,
      panel === 'color',
    )
    setPanelPos(pos)
  }, [panel, iconTab])

  useEffect(() => {
    if (!panel) return
    const onDoc = (e: MouseEvent) => {
      const t = e.target as Node
      if (toolbarRef.current?.contains(t) || panelRef.current?.contains(t)) return
      setPanel(null)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setPanel(null)
    }
    document.addEventListener('mousedown', onDoc)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDoc)
      document.removeEventListener('keydown', onKey)
    }
  }, [panel])

  const filteredIcons = useMemo(() => {
    const q = iconQuery.trim().toLowerCase()
    if (!q) return BANNER_ICONS
    return BANNER_ICONS.filter((i) => i.label.toLowerCase().includes(q) || i.id.includes(q))
  }, [iconQuery])

  if (!rect) return null

  const toolbarH = 36
  const toolbarW = 148
  const spaceAbove = rect.top - 8
  const placeToolbarAbove = spaceAbove >= toolbarH + 6
  const toolbarTop = placeToolbarAbove
    ? Math.max(8, rect.top - toolbarH - 6)
    : Math.min(rect.bottom + 6, window.innerHeight - toolbarH - 8)
  const toolbarLeft = Math.min(
    Math.max(8, rect.left + (rect.width - toolbarW) / 2),
    window.innerWidth - toolbarW - 8,
  )

  const openPanel = (kind: PanelKind, e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
    if (panel === kind) {
      setPanel(null)
      return
    }
    anchorRef.current = (e.currentTarget as HTMLElement).getBoundingClientRect()
    if (kind === 'emoji') {
      setIconTab('icon')
      setIconQuery('')
    }
    setPanel(kind)
  }

  const setVariant = (variant: string, tone: 'solid' | 'soft') => {
    BANNER_VARIANT_IDS.forEach((id) => block.classList.remove(`doc-banner-${id}`))
    block.classList.remove('doc-banner-soft', 'doc-banner-warning', 'doc-banner-teal')
    block.classList.add('doc-banner', `doc-banner-${variant}`)
    if (tone === 'soft') block.classList.add('doc-banner-soft')
    block.setAttribute('data-banner-variant', variant)
    block.setAttribute('data-banner-tone', tone)
    block.style.background = ''
    block.style.borderColor = ''
    block.style.color = ''
    const swatch = BANNER_PICKER_SWATCHES.find((s) => s.variant === variant)
    if (swatch) setIconTint(tone === 'soft' ? swatch.soft : swatch.color)
    setPanel(null)
    onChange()
  }

  const ensureIconEl = () => {
    let iconEl = block.querySelector('.doc-banner-icon') as HTMLElement | null
    if (!iconEl) {
      iconEl = document.createElement('span')
      iconEl.className = 'doc-banner-icon'
      iconEl.contentEditable = 'false'
      block.insertBefore(iconEl, block.firstChild)
    }
    return iconEl
  }

  const setLucideIcon = (id: string) => {
    const entry = BANNER_ICONS.find((i) => i.id === id)
    if (!entry) return
    const iconEl = ensureIconEl()
    iconEl.setAttribute('data-banner-icon', id)
    iconEl.style.color = iconTint
    iconEl.innerHTML = iconSvgMarkup(entry.Icon, iconTint)
    setPanel(null)
    onChange()
  }

  const setEmojiIcon = (emoji: string | null) => {
    if (!emoji) {
      block.querySelector('.doc-banner-icon')?.remove()
      setPanel(null)
      onChange()
      return
    }
    const iconEl = ensureIconEl()
    iconEl.removeAttribute('data-banner-icon')
    iconEl.style.color = ''
    iconEl.innerHTML = ''
    iconEl.textContent = emoji
    setPanel(null)
    onChange()
  }

  const removeBannerStyle = () => {
    const body = block.querySelector('.doc-banner-body')
    const html = body ? body.innerHTML : block.innerHTML
    const p = document.createElement('p')
    p.innerHTML = html.replace(/<span class="doc-banner-icon"[^>]*>[\s\S]*?<\/span>/g, '')
    block.replaceWith(p)
    onClose()
    onChange()
  }

  const iconEl = block.querySelector('.doc-banner-icon') as HTMLElement | null
  const currentLucideId = iconEl?.getAttribute('data-banner-icon') || ''
  const currentEmoji = currentLucideId ? '' : iconEl?.textContent || ''
  const hasIcon = Boolean(currentLucideId || currentEmoji)
  const currentVariant = block.getAttribute('data-banner-variant') || 'info'
  const currentTone = (block.getAttribute('data-banner-tone') || 'solid') as 'solid' | 'soft'
  const CurrentLucide = BANNER_ICONS.find((i) => i.id === currentLucideId)?.Icon
  const swatchColor =
    BANNER_PICKER_SWATCHES.find((s) => s.variant === currentVariant)?.[
      currentTone === 'soft' ? 'soft' : 'color'
    ] || '#ec4899'

  return createPortal(
    <div data-doc-block-chrome="banner">
      <div
        ref={toolbarRef}
        role="toolbar"
        aria-label="Banner options"
        style={{ position: 'fixed', top: toolbarTop, left: toolbarLeft }}
        className="z-[55] flex h-9 items-center gap-0.5 rounded-lg border border-ink-700 bg-ink-850 px-1 shadow-popover"
        onMouseDown={(e) => e.preventDefault()}
      >
        <ToolbarBtn label="Icon" active={panel === 'emoji'} onClick={(e) => openPanel('emoji', e)}>
          <span className="flex items-center gap-0.5 text-sm">
            {CurrentLucide ? (
              <CurrentLucide size={14} style={{ color: iconEl?.style.color || swatchColor }} />
            ) : currentEmoji ? (
              <span>{currentEmoji}</span>
            ) : (
              <Smile size={14} />
            )}
            <ChevronDown size={11} className="opacity-60" />
          </span>
        </ToolbarBtn>
        <ToolbarBtn label="Color" active={panel === 'color'} onClick={(e) => openPanel('color', e)}>
          <span className="flex items-center gap-0.5">
            <span
              className="h-3.5 w-3.5 rounded-full border border-ink-600"
              style={{ background: swatchColor }}
            />
            <ChevronDown size={11} className="opacity-60" />
          </span>
        </ToolbarBtn>
        <ToolbarBtn label="More" active={panel === 'more'} onClick={(e) => openPanel('more', e)}>
          <MoreHorizontal size={14} />
        </ToolbarBtn>
      </div>

      {panel && (
        <div
          ref={panelRef}
          data-doc-block-chrome="banner-panel"
          className={cn(
            'menu-panel fixed z-[60] overflow-hidden',
            panel === 'emoji' && 'w-[22rem]',
            panel === 'color' && 'w-56',
            panel === 'more' && 'w-52',
          )}
          style={{
            top: panelPos.top,
            left: panelPos.left,
            maxHeight: panelPos.maxHeight,
          }}
          onMouseDown={(e) => e.stopPropagation()}
        >
          {panel === 'emoji' && (
            <div
              className="flex flex-col overflow-hidden"
              style={{ maxHeight: panelPos.maxHeight }}
            >
              <div className="flex items-center justify-between border-b border-ink-700 px-3 pt-2">
                <div className="flex gap-3 text-xs font-medium">
                  <button
                    type="button"
                    className={cn(
                      'border-b-2 pb-2 transition-colors',
                      iconTab === 'icon'
                        ? 'border-fg text-fg'
                        : 'border-transparent text-fg-muted hover:text-fg',
                    )}
                    onClick={() => setIconTab('icon')}
                  >
                    Icon
                  </button>
                  <button
                    type="button"
                    className={cn(
                      'border-b-2 pb-2 transition-colors',
                      iconTab === 'emoji'
                        ? 'border-fg text-fg'
                        : 'border-transparent text-fg-muted hover:text-fg',
                    )}
                    onClick={() => setIconTab('emoji')}
                  >
                    Emoji
                  </button>
                </div>
                {hasIcon && (
                  <button
                    type="button"
                    className="mb-2 text-[11px] text-fg-muted hover:text-fg"
                    onClick={() => setEmojiIcon(null)}
                  >
                    Reset
                  </button>
                )}
              </div>

              {iconTab === 'icon' ? (
                <div className="flex min-h-0 flex-1 flex-col gap-2 p-2">
                  <div className="flex items-center gap-2">
                    <input
                      autoFocus
                      value={iconQuery}
                      onChange={(e) => setIconQuery(e.target.value)}
                      placeholder="Search..."
                      aria-label="Search icons"
                      className="input-dark min-w-0 flex-1 !py-1.5 text-xs"
                    />
                    <label className="relative h-8 w-8 shrink-0 cursor-pointer overflow-hidden rounded-full border border-ink-600">
                      <span
                        className="absolute inset-0"
                        style={{ background: iconTint }}
                        aria-hidden
                      />
                      <input
                        type="color"
                        value={iconTint}
                        onChange={(e) => setIconTint(e.target.value)}
                        className="absolute inset-0 cursor-pointer opacity-0"
                        aria-label="Icon color"
                      />
                    </label>
                  </div>
                  <div
                    className="min-h-0 flex-1 overflow-y-auto"
                    style={{ maxHeight: Math.max(160, panelPos.maxHeight - 120) }}
                  >
                    {filteredIcons.length === 0 ? (
                      <p className="py-6 text-center text-xs text-fg-muted">No icons found.</p>
                    ) : (
                      <div className="grid grid-cols-8 gap-0.5">
                        {filteredIcons.map(({ id, label, Icon }) => (
                          <button
                            key={id}
                            type="button"
                            title={label}
                            aria-label={label}
                            onClick={() => setLucideIcon(id)}
                            className={cn(
                              'relative flex h-9 w-9 items-center justify-center rounded-lg transition-colors hover:bg-ink-750',
                              currentLucideId === id && 'bg-ink-750',
                            )}
                          >
                            <Icon size={18} style={{ color: iconTint }} strokeWidth={2} />
                            {currentLucideId === id && (
                              <Check
                                size={10}
                                className="absolute bottom-0.5 right-0.5 text-fg"
                              />
                            )}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              ) : (
                <div
                  className="overflow-y-auto p-2"
                  style={{ maxHeight: Math.max(160, panelPos.maxHeight - 48) }}
                >
                  <EmojiPicker onPick={(emoji) => setEmojiIcon(emoji)} />
                </div>
              )}
            </div>
          )}

          {panel === 'color' && (
            <div className="space-y-2.5 p-2.5">
              <div className="grid grid-cols-8 gap-1.5">
                {BANNER_PICKER_SWATCHES.map((s) => (
                  <button
                    key={`solid-${s.variant}`}
                    type="button"
                    title={s.label}
                    aria-label={s.label}
                    onClick={() => setVariant(s.variant, 'solid')}
                    className={cn(
                      'flex h-7 w-7 items-center justify-center rounded-full border-2',
                      currentVariant === s.variant && currentTone === 'solid'
                        ? 'border-fg'
                        : 'border-transparent hover:border-ink-500',
                    )}
                  >
                    <span
                      className="h-5 w-5 rounded-full border border-ink-600/40"
                      style={{ background: s.color }}
                    />
                  </button>
                ))}
              </div>
              <div className="grid grid-cols-8 gap-1.5">
                {BANNER_PICKER_SWATCHES.map((s) => (
                  <button
                    key={`soft-${s.variant}`}
                    type="button"
                    title={`${s.label} soft`}
                    aria-label={`${s.label} soft`}
                    onClick={() => setVariant(s.variant, 'soft')}
                    className={cn(
                      'flex h-7 w-7 items-center justify-center rounded-full border-2',
                      currentVariant === s.variant && currentTone === 'soft'
                        ? 'border-fg'
                        : 'border-transparent hover:border-ink-500',
                    )}
                  >
                    <span
                      className="h-5 w-5 rounded-full border border-ink-600/40"
                      style={{ background: s.soft }}
                    />
                  </button>
                ))}
              </div>
            </div>
          )}

          {panel === 'more' && (
            <div className="py-1">
              <MenuRow
                icon={<BookmarkMinus size={14} />}
                label="Remove Banner Style"
                onClick={removeBannerStyle}
                disabled={readOnly}
              />
              <MenuRow
                icon={<Copy size={14} />}
                label="Duplicate"
                disabled={readOnly}
                onClick={() => {
                  duplicateEditorBlock(block)
                  toast.success('Banner duplicated')
                  setPanel(null)
                  onChange()
                }}
              />
              <MenuRow
                icon={<Link2 size={14} />}
                label="Copy Block Link"
                onClick={() => {
                  void copyBlockLink(block, docId)
                    .then(() => toast.success('Block link copied'))
                    .catch(() => toast.error('Could not copy link'))
                  setPanel(null)
                }}
              />
              <div className="my-1 h-px bg-ink-700" />
              <MenuRow
                icon={<Trash2 size={14} />}
                label="Delete"
                danger
                disabled={readOnly}
                onClick={() => {
                  deleteEditorBlock(block)
                  setPanel(null)
                  onClose()
                  toast.success('Banner deleted')
                  onChange()
                }}
              />
            </div>
          )}
        </div>
      )}
    </div>,
    document.body,
  )
}

function ToolbarBtn({
  label,
  active,
  onClick,
  children,
}: {
  label: string
  active?: boolean
  onClick: (e: React.MouseEvent) => void
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      aria-expanded={active}
      onClick={onClick}
      className={cn(
        'flex h-7 items-center rounded-md px-1.5 text-fg-secondary transition-colors',
        active ? 'bg-ink-700 text-fg' : 'hover:bg-ink-750 hover:text-fg',
      )}
    >
      {children}
    </button>
  )
}

function MenuRow({
  icon,
  label,
  onClick,
  danger,
  disabled,
}: {
  icon: React.ReactNode
  label: string
  onClick: () => void
  danger?: boolean
  disabled?: boolean
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={cn(
        'menu-item w-full disabled:cursor-not-allowed disabled:opacity-50',
        danger && 'text-red-400 hover:text-red-300',
      )}
    >
      {icon}
      {label}
    </button>
  )
}

export function getBannerBlock(node: Element | null): HTMLElement | null {
  if (!node) return null
  const el = (node as HTMLElement).closest?.('.doc-banner')
  return el instanceof HTMLElement ? el : null
}

export function createBannerHtml(
  variant: string,
  text: string,
  icon = '🚩',
  tone: 'solid' | 'soft' = 'solid',
) {
  const safe = text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
  const softClass = tone === 'soft' ? ' doc-banner-soft' : ''
  return `<div class="doc-banner doc-banner-${variant}${softClass}" data-block-type="banner" data-banner-variant="${variant}" data-banner-tone="${tone}"><span class="doc-banner-icon" contenteditable="false">${icon}</span><div class="doc-banner-body"><p>${safe}</p></div></div><p><br></p>`
}
