import { useState } from 'react'
import {
  ChevronRight,
  Clock,
  Columns2,
  Eye,
  EyeOff,
  FileText,
  Image,
  LayoutList,
  Link2,
  List,
  Smile,
  Table2,
  Type,
  User,
  Users,
} from 'lucide-react'

import { cn } from '../../../../lib/utils'
import type {
  DocFontSize,
  DocFontStyle,
  DocInsertBlock,
  DocPageSettings,
  DocPageWidth,
  RelationshipsView,
  SubpagesView,
} from '../../types/pageSettings'
import { DEFAULT_PAGE_SETTINGS } from '../../types/pageSettings'
import { formatReadingTime } from '../../utils/docStats'
import { PageIconPicker } from './PageIconPicker'

function Toggle({
  checked,
  onChange,
  disabled,
}: {
  checked: boolean
  onChange: (v: boolean) => void
  disabled?: boolean
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={(e) => {
        e.stopPropagation()
        onChange(!checked)
      }}
      className={cn(
        'relative h-5 w-9 shrink-0 rounded-full transition-colors disabled:opacity-50',
        checked ? 'bg-brand' : 'bg-ink-700',
      )}
    >
      <span
        className={cn(
          'absolute top-0.5 h-4 w-4 rounded-full bg-white transition-all',
          checked ? 'left-[18px]' : 'left-0.5',
        )}
      />
    </button>
  )
}

function StyleButton({
  active,
  onClick,
  children,
  label,
}: {
  active: boolean
  onClick: () => void
  children: React.ReactNode
  label: string
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        'flex flex-1 flex-col items-center justify-center gap-1 rounded-lg border px-3 py-3 text-xs font-medium transition-colors',
        active
          ? 'border-brand/40 bg-brand-soft text-brand'
          : 'border-ink-700 bg-ink-800 text-fg-secondary hover:border-ink-600 hover:text-fg',
      )}
    >
      {children}
      <span>{label}</span>
    </button>
  )
}

function SettingRow({
  icon: Icon,
  label,
  checked,
  onChange,
  disabled,
  onRowClick,
}: {
  icon: typeof Image
  label: string
  checked: boolean
  onChange: (v: boolean) => void
  disabled?: boolean
  onRowClick?: () => void
}) {
  return (
    <div
      className={cn(
        'flex items-center gap-2 rounded-lg px-2 py-2 transition-colors',
        onRowClick && 'cursor-pointer hover:bg-ink-800',
      )}
      onClick={onRowClick}
      onKeyDown={onRowClick ? (e) => e.key === 'Enter' && onRowClick() : undefined}
      role={onRowClick ? 'button' : undefined}
      tabIndex={onRowClick ? 0 : undefined}
    >
      <Icon size={15} className="shrink-0 text-fg-muted" />
      <span className="min-w-0 flex-1 text-sm text-fg-secondary">{label}</span>
      <Toggle checked={checked} onChange={onChange} disabled={disabled} />
    </div>
  )
}

function MenuRow({
  icon: Icon,
  label,
  value,
  options,
  onChange,
  disabled,
}: {
  icon: typeof List
  label: string
  value: string
  options: { value: string; label: string }[]
  onChange: (v: string) => void
  disabled?: boolean
}) {
  const [open, setOpen] = useState(false)
  const current = options.find((o) => o.value === value)?.label ?? value

  return (
    <div className="relative">
      <button
        type="button"
        disabled={disabled}
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-2 rounded-lg px-2 py-2 text-left transition-colors hover:bg-ink-800 disabled:opacity-50"
      >
        <Icon size={15} className="shrink-0 text-fg-muted" />
        <span className="min-w-0 flex-1 text-sm text-fg-secondary">{label}</span>
        <span className="text-xs text-fg-muted">{current}</span>
        <ChevronRight size={14} className="text-fg-muted" />
      </button>
      {open && (
        <div className="absolute right-0 top-full z-20 mt-1 min-w-[120px] rounded-lg border border-ink-700 bg-ink-850 py-1 shadow-popover">
          {options.map((opt) => (
            <button
              key={opt.value}
              type="button"
              onClick={() => {
                onChange(opt.value)
                setOpen(false)
              }}
              className={cn(
                'block w-full px-3 py-1.5 text-left text-xs transition-colors hover:bg-ink-800',
                opt.value === value ? 'text-brand' : 'text-fg-secondary',
              )}
            >
              {opt.label}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

interface PageStylesPanelProps {
  settings: DocPageSettings
  onChange: (patch: Partial<DocPageSettings>) => void
  readOnly?: boolean
  docIcon?: string | null
  onIconChange?: (icon: string | null) => void
  onInsertBlock?: (type: DocInsertBlock) => void
  onApplyTypographyPage?: () => void
  onApplyTypographyAll?: () => void
  stats?: { words: number; chars: number; readingTimeSec: number }
  onOpenLinks?: () => void
}

/** ClickUp-style page typography, header, blocks, and stats settings. */
export function PageStylesPanel({
  settings,
  onChange,
  readOnly,
  docIcon,
  onIconChange,
  onInsertBlock,
  onApplyTypographyPage,
  onApplyTypographyAll,
  stats,
  onOpenLinks,
}: PageStylesPanelProps) {
  const s = { ...DEFAULT_PAGE_SETTINGS, ...settings }
  const [iconPickerOpen, setIconPickerOpen] = useState(false)

  const setFontStyle = (fontStyle: DocFontStyle) => !readOnly && onChange({ fontStyle })
  const setFontSize = (fontSize: DocFontSize) => !readOnly && onChange({ fontSize })
  const setPageWidth = (pageWidth: DocPageWidth) => !readOnly && onChange({ pageWidth })
  const setBool = (key: keyof DocPageSettings, value: boolean) => !readOnly && onChange({ [key]: value })

  const insertBlocks: { type: DocInsertBlock; label: string; icon: typeof Table2 }[] = [
    { type: 'table', label: 'Table', icon: Table2 },
    { type: 'column', label: 'Column', icon: Columns2 },
    { type: 'list', label: 'FlowDesk List', icon: List },
    { type: 'subpage', label: 'Subpage', icon: FileText },
  ]

  return (
    <div className="flex h-full flex-col overflow-y-auto">
      <div className="border-b border-ink-700 px-4 py-3">
        <h3 className="text-sm font-semibold text-fg">Page Styles</h3>
      </div>

      <div className="space-y-5 p-4">
        <section>
          <p className="mb-2 text-xs font-medium text-fg-muted">Font style</p>
          <div className="flex gap-2">
            <StyleButton active={s.fontStyle === 'system'} onClick={() => setFontStyle('system')} label="System">
              <span className="text-lg font-sans">Aa</span>
            </StyleButton>
            <StyleButton active={s.fontStyle === 'serif'} onClick={() => setFontStyle('serif')} label="Serif">
              <span className="font-serif text-lg">Ss</span>
            </StyleButton>
            <StyleButton active={s.fontStyle === 'mono'} onClick={() => setFontStyle('mono')} label="Mono">
              <span className="font-mono text-lg">00</span>
            </StyleButton>
          </div>
        </section>

        <section>
          <p className="mb-2 text-xs font-medium text-fg-muted">Font size</p>
          <div className="flex gap-2">
            <StyleButton active={s.fontSize === 'small'} onClick={() => setFontSize('small')} label="Small">
              <span className="text-xs">Aa</span>
            </StyleButton>
            <StyleButton active={s.fontSize === 'default'} onClick={() => setFontSize('default')} label="Default">
              <span className="text-sm">Aa</span>
            </StyleButton>
            <StyleButton active={s.fontSize === 'large'} onClick={() => setFontSize('large')} label="Large">
              <span className="text-base">Aa</span>
            </StyleButton>
          </div>
        </section>

        <section>
          <p className="mb-2 text-xs font-medium text-fg-muted">Page width</p>
          <div className="flex gap-2">
            <StyleButton active={s.pageWidth === 'default'} onClick={() => setPageWidth('default')} label="Default">
              <span className="h-3 w-8 rounded border border-current opacity-60" />
            </StyleButton>
            <StyleButton active={s.pageWidth === 'full'} onClick={() => setPageWidth('full')} label="Full width">
              <span className="h-3 w-12 rounded border border-current opacity-60" />
            </StyleButton>
          </div>
        </section>

        {!readOnly && (onApplyTypographyPage || onApplyTypographyAll) && (
          <div className="space-y-2">
            {onApplyTypographyPage && (
              <button
                type="button"
                onClick={onApplyTypographyPage}
                className="w-full rounded-lg border border-brand/40 bg-brand/10 px-3 py-2 text-xs font-medium text-fg transition-colors hover:border-brand/60 hover:bg-brand/15"
              >
                Apply typography to this page
              </button>
            )}
            {onApplyTypographyAll && (
              <button
                type="button"
                onClick={onApplyTypographyAll}
                className="w-full rounded-lg border border-ink-700 bg-ink-800 px-3 py-2 text-xs font-medium text-fg-muted transition-colors hover:border-ink-600 hover:text-fg-secondary"
              >
                Apply typography to all pages
              </button>
            )}
          </div>
        )}

        <section>
          <p className="mb-1 text-xs font-medium text-fg-muted">Add new</p>
          <div className="grid grid-cols-2 gap-1">
            {insertBlocks.map(({ type, label, icon: Icon }) => (
              <button
                key={type}
                type="button"
                disabled={readOnly || !onInsertBlock}
                onClick={() => onInsertBlock?.(type)}
                className="flex items-center gap-2 rounded-lg px-2 py-2 text-left text-xs text-fg-secondary transition-colors hover:bg-ink-800 hover:text-fg disabled:opacity-50"
              >
                <Icon size={14} className="text-fg-muted" />
                {label}
              </button>
            ))}
          </div>
        </section>

        <section>
          <p className="mb-1 text-xs font-medium text-fg-muted">Header</p>
          <div className="space-y-0.5">
            <SettingRow
              icon={Image}
              label="Cover image"
              checked={s.showCover}
              onChange={(v) => setBool('showCover', v)}
              disabled={readOnly}
            />
            <div className="relative">
              <SettingRow
                icon={Smile}
                label="Page icon & title"
                checked={s.showPageIcon}
                onChange={(v) => setBool('showPageIcon', v)}
                disabled={readOnly}
                onRowClick={!readOnly && onIconChange ? () => setIconPickerOpen((v) => !v) : undefined}
              />
              {iconPickerOpen && onIconChange && (
                <div className="px-2 pb-2">
                  <PageIconPicker icon={docIcon} onChange={onIconChange} readOnly={readOnly} />
                </div>
              )}
            </div>
            <SettingRow
              icon={User}
              label="Owners"
              checked={s.showOwners}
              onChange={(v) => setBool('showOwners', v)}
              disabled={readOnly}
            />
            <SettingRow
              icon={Users}
              label="Contributors"
              checked={s.showContributors}
              onChange={(v) => setBool('showContributors', v)}
              disabled={readOnly}
            />
            <SettingRow
              icon={Type}
              label="Subtitle"
              checked={s.showSubtitle}
              onChange={(v) => setBool('showSubtitle', v)}
              disabled={readOnly}
            />
            {s.showSubtitle && !readOnly && (
              <input
                value={s.subtitle}
                onChange={(e) => onChange({ subtitle: e.target.value })}
                placeholder="Add a subtitle…"
                className="mx-2 mb-1 w-[calc(100%-1rem)] rounded-lg border border-ink-700 bg-ink-800 px-2.5 py-1.5 text-xs text-fg outline-none focus:border-brand"
              />
            )}
            <SettingRow
              icon={Clock}
              label="Last modified"
              checked={s.showLastModified}
              onChange={(v) => setBool('showLastModified', v)}
              disabled={readOnly}
            />
          </div>
        </section>

        <section>
          <p className="mb-1 text-xs font-medium text-fg-muted">Sections</p>
          <div className="space-y-0.5">
            <MenuRow
              icon={LayoutList}
              label="Subpages"
              value={s.subpagesView}
              options={[
                { value: 'table', label: 'Table' },
                { value: 'list', label: 'List' },
                { value: 'cards', label: 'Cards' },
              ]}
              onChange={(v) => !readOnly && onChange({ subpagesView: v as SubpagesView })}
              disabled={readOnly}
            />
            <MenuRow
              icon={Link2}
              label="Relationships"
              value={s.relationshipsView}
              options={[
                { value: 'dialog', label: 'Dialog' },
                { value: 'inline', label: 'Inline' },
              ]}
              onChange={(v) => {
                if (readOnly) return
                onChange({ relationshipsView: v as RelationshipsView })
                if (v === 'dialog') onOpenLinks?.()
              }}
              disabled={readOnly}
            />
            <SettingRow
              icon={List}
              label="Page outline"
              checked={s.showPageOutline}
              onChange={(v) => setBool('showPageOutline', v)}
              disabled={readOnly}
            />
          </div>
        </section>

        <section>
          <p className="mb-1 text-xs font-medium text-fg-muted">Focus mode</p>
          <div className="space-y-0.5">
            <SettingRow
              icon={EyeOff}
              label="Block"
              checked={s.focusBlock}
              onChange={(v) => setBool('focusBlock', v)}
              disabled={readOnly}
            />
            <SettingRow
              icon={Eye}
              label="Page"
              checked={s.focusPage}
              onChange={(v) => setBool('focusPage', v)}
              disabled={readOnly}
            />
          </div>
        </section>

        <section>
          <p className="mb-2 text-xs font-medium text-fg-muted">Stats</p>
          <div className="space-y-2 rounded-lg border border-ink-700 bg-ink-800 px-3 py-2.5 text-xs">
            <div className="flex justify-between text-fg-secondary">
              <span>Word count</span>
              <span className="text-fg">{stats?.words ?? 0}</span>
            </div>
            <div className="flex justify-between text-fg-secondary">
              <span>Characters</span>
              <span className="text-fg">{stats?.chars ?? 0}</span>
            </div>
            <div className="flex justify-between text-fg-secondary">
              <span>Reading time</span>
              <span className="text-fg">{formatReadingTime(stats?.readingTimeSec ?? 0)}</span>
            </div>
            <div className="flex items-center justify-between border-t border-ink-700 pt-2">
              <span className="text-fg-secondary">Show stats on page</span>
              <Toggle
                checked={s.showStatsOnPage}
                onChange={(v) => setBool('showStatsOnPage', v)}
                disabled={readOnly}
              />
            </div>
          </div>
        </section>
      </div>
    </div>
  )
}

export function pageSettingsTypography(settings?: DocPageSettings): string {
  const s = { ...DEFAULT_PAGE_SETTINGS, ...settings }
  const font =
    s.fontStyle === 'serif' ? 'font-serif' : s.fontStyle === 'mono' ? 'font-mono' : 'font-sans'
  const size = s.fontSize === 'small' ? 'text-sm' : s.fontSize === 'large' ? 'text-lg' : 'text-base'
  return cn(font, size)
}

export function pageSettingsWidth(settings?: DocPageSettings): string {
  const s = { ...DEFAULT_PAGE_SETTINGS, ...settings }
  return s.pageWidth === 'full' ? 'max-w-5xl' : 'max-w-3xl'
}

export function pageSettingsClasses(settings?: DocPageSettings): string {
  return cn(pageSettingsTypography(settings), pageSettingsWidth(settings), 'mx-auto w-full')
}

export function pageFocusClasses(settings?: DocPageSettings): string {
  const s = { ...DEFAULT_PAGE_SETTINGS, ...settings }
  if (s.focusPage) return 'doc-focus-page'
  if (s.focusBlock) return 'doc-focus-block'
  return ''
}
