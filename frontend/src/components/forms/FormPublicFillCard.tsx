import type { FormField } from '../../lib/types'
import { cn } from '../../lib/utils'
import { FormFieldsRenderer } from './FormFieldsRenderer'

/** Background used on the public form page (shared link only). */
export const PUBLIC_FORM_GRADIENT =
  'linear-gradient(135deg, #fde8d7 0%, #fbd9e0 18%, #ecdcf5 38%, #ffffff 60%, #e3ecfb 82%, #cfe0f7 100%)'

export type FormPublicFillTheme = 'light' | 'dark'

export type FormPublicFillCardProps = {
  workspaceName: string
  name: string
  description: string | null
  fields: FormField[]
  values: Record<string, string>
  onChange: (id: string, value: string) => void
  email?: string
  onEmailChange?: (value: string) => void
  showEmail?: boolean
  error?: string
  preview?: boolean
  submitting?: boolean
  onSubmit?: () => void
  theme?: FormPublicFillTheme
  submitDisabled?: boolean
  paused?: boolean
  /** Tighter layout for the in-app builder preview column. */
  compact?: boolean
  /** Flat layout inside the builder preview shell (no nested card chrome). */
  embedded?: boolean
  className?: string
}

export function FormPublicFillCard({
  workspaceName,
  name,
  description,
  fields,
  values,
  onChange,
  email = '',
  onEmailChange,
  showEmail = true,
  error,
  preview = false,
  submitting = false,
  onSubmit,
  theme = 'light',
  submitDisabled = false,
  paused = false,
  compact = false,
  embedded = false,
  className,
}: FormPublicFillCardProps) {
  const light = theme === 'light'

  const emailInputCls = light
    ? embedded
      ? 'input-dark'
      : 'w-full rounded-lg border border-gray-300 bg-white px-3.5 py-2.5 text-sm text-gray-900 outline-none placeholder:text-gray-400 focus:border-brand focus:ring-2 focus:ring-brand/20'
    : 'input-dark'
  const emailLabelCls = light
    ? embedded
      ? 'mb-1.5 block text-xs font-medium text-fg-secondary'
      : 'mb-1.5 block text-sm font-medium text-gray-800'
    : 'mb-1.5 block text-xs font-medium text-fg-secondary'

  return (
    <div
      className={cn(
        embedded
          ? undefined
          : light
            ? 'rounded-2xl border border-gray-200 bg-white p-8 shadow-xl'
            : 'rounded-2xl border border-ink-700 bg-ink-850/60 p-6',
        className,
      )}
    >
      <div className="mb-1 flex items-center gap-2">
        <img src="/brightcone icon.png" alt="" className="h-6 w-6" />
        <span
          className={cn(
            'text-xs font-medium uppercase tracking-widest',
            light && !embedded ? 'text-gray-400' : 'text-fg-muted',
          )}
        >
          {workspaceName}
        </span>
      </div>

      <h1
        className={cn(
          'font-bold',
          compact ? 'text-lg' : 'text-2xl',
          light && !embedded ? 'text-gray-900' : 'text-fg',
        )}
      >
        {name}
      </h1>
      {description && (
        <p
          className={cn(
            compact ? 'mt-1 text-sm' : 'mt-1.5 text-sm',
            light && !embedded ? 'text-gray-600' : 'text-fg-secondary',
          )}
        >
          {description}
        </p>
      )}

      <div className={compact ? 'mt-5' : 'mt-6'}>
        <FormFieldsRenderer
          light={light && !embedded}
          fields={fields}
          values={values}
          onChange={onChange}
        />
        {showEmail && (
          <div className="mt-4">
            <label className={emailLabelCls}>Your email (optional)</label>
            <input
              type="email"
              className={emailInputCls}
              placeholder="you@company.com"
              value={email}
              onChange={(e) => onEmailChange?.(e.target.value)}
              disabled={preview && !onEmailChange}
            />
          </div>
        )}
      </div>

      {paused && (
        <p className={cn('mt-4 rounded-lg px-3 py-2 text-sm', light && !embedded ? 'bg-amber-50 text-amber-800' : 'bg-amber-500/10 text-amber-300')}>
          This form is paused and not accepting new submissions.
        </p>
      )}

      {error && (
        <p className={cn('mt-3 text-sm', light && !embedded ? 'text-red-600' : 'text-red-400')}>{error}</p>
      )}

      <button
        type="button"
        onClick={onSubmit}
        disabled={preview || submitting || submitDisabled}
        className={cn(
          'mt-6 w-full rounded-lg py-2.5 text-sm font-semibold transition-colors disabled:opacity-60',
          light && !embedded
            ? 'bg-brand text-white hover:bg-brand-hover'
            : 'btn-primary',
        )}
      >
        {preview ? 'Submit (preview)' : submitting ? 'Submitting…' : 'Submit'}
      </button>
    </div>
  )
}

export function FormPublicPoweredBy({
  className,
  theme = 'light',
}: {
  className?: string
  theme?: FormPublicFillTheme
}) {
  return (
    <p className={cn('text-xs', theme === 'dark' ? 'text-fg-muted' : 'text-gray-500', className)}>
      Powered by <span className="font-semibold">FlowDesk</span>
    </p>
  )
}
