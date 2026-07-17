declare global {
  interface Window {
    clarity?: ((...args: unknown[]) => void) & { q?: unknown[] }
  }
}

const CLARITY_SCRIPT_HOST = 'https://www.clarity.ms'

/** Project id from env; falls back to the existing production id. */
export const CLARITY_PROJECT_ID =
  (import.meta.env.VITE_CLARITY_ID as string | undefined) || 'x7xpii2cjd'

/** Clarity masks input/dropdown content by default; we also enable explicit consent. */
export const CLARITY_INPUT_MASKING_ENABLED = true as const

export function clarityScriptUrl(projectId: string = CLARITY_PROJECT_ID): string {
  return `${CLARITY_SCRIPT_HOST}/tag/${projectId}`
}

/**
 * Load Microsoft Clarity from a controlled module (not an inline index.html snippet).
 * Clarity does not publish SRI hashes for /tag/{id}; crossOrigin is set on the script tag.
 * Inputs are masked by Clarity by default; consent is invoked per the Clarity client API.
 */
export function initClarity(): void {
  if (typeof window === 'undefined' || typeof document === 'undefined') return
  if (!CLARITY_PROJECT_ID) return
  if (!import.meta.env.PROD) return

  const name = 'clarity'
  if (!window.clarity) {
    window.clarity = (...args: unknown[]) => {
      window.clarity!.q = window.clarity!.q || []
      window.clarity!.q.push(args)
    }
  }

  window.clarity('consent')
  document.documentElement.setAttribute('data-clarity-mask', 'true')

  const script = document.createElement('script')
  script.async = true
  script.crossOrigin = 'anonymous'
  script.src = clarityScriptUrl()
  const first = document.getElementsByTagName('script')[0]
  first?.parentNode?.insertBefore(script, first)
}
