/** Official brand marks as inline SVGs (App Center, Planner, integrations). */

interface BrandIconProps {
  size?: number
  className?: string
}

export function GitHubIcon({ size = 18, className }: BrandIconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" className={className} fill="currentColor" aria-label="GitHub">
      <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.012 8.012 0 0 0 16 8c0-4.42-3.58-8-8-8z" />
    </svg>
  )
}

export function GoogleCalendarIcon({ size = 18, className }: BrandIconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 200 200" className={className} aria-label="Google Calendar">
      <path fill="#ffffff" d="M152.63 47.37H47.37v105.26h105.26z" />
      <path fill="#4285f4" d="M152.63 0H15.79C7.07 0 0 7.07 0 15.79v136.84h47.37V47.37h105.26z" />
      <path fill="#1967d2" d="M200 47.37V15.79C200 7.07 192.93 0 184.21 0h-31.58v47.37z" />
      <path fill="#fbbc04" d="M200 47.37h-47.37v105.26H200z" />
      <path fill="#34a853" d="M152.63 152.63H47.37V200h105.26z" />
      <path fill="#188038" d="M0 152.63v31.58C0 192.93 7.07 200 15.79 200h31.58v-47.37z" />
      <path fill="#1a73e8" d="M152.63 200 200 152.63h-47.37z" />
      <text
        x="100"
        y="134"
        textAnchor="middle"
        fontFamily="Arial, Helvetica, sans-serif"
        fontSize="86"
        fontWeight="400"
        fill="#1a73e8"
      >
        31
      </text>
    </svg>
  )
}

export function GoogleDriveIcon({ size = 18, className }: BrandIconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 87.3 78" className={className} aria-label="Google Drive">
      <path fill="#0066da" d="m6.6 66.85 3.85 6.65c.8 1.4 1.95 2.5 3.3 3.3l13.75-23.8h-27.5c0 1.55.4 3.1 1.2 4.5z" />
      <path fill="#00ac47" d="m43.65 25-13.75-23.8c-1.35.8-2.5 1.9-3.3 3.3l-25.4 44a9.06 9.06 0 0 0-1.2 4.5h27.5z" />
      <path fill="#ea4335" d="m73.55 76.8c1.35-.8 2.5-1.9 3.3-3.3l1.6-2.75 7.65-13.25c.8-1.4 1.2-2.95 1.2-4.5h-27.5l5.85 11.5z" />
      <path fill="#00832d" d="m43.65 25 13.75-23.8c-1.35-.8-2.9-1.2-4.5-1.2h-18.5c-1.6 0-3.15.45-4.5 1.2z" />
      <path fill="#2684fc" d="m59.8 53h-32.3l-13.75 23.8c1.35.8 2.9 1.2 4.5 1.2h50.8c1.6 0 3.15-.45 4.5-1.2z" />
      <path fill="#ffba00" d="m73.4 26.5-12.7-22c-.8-1.4-1.95-2.5-3.3-3.3l-13.75 23.8 16.15 28h27.45c0-1.55-.4-3.1-1.2-4.5z" />
    </svg>
  )
}

export function OutlookIcon({ size = 18, className }: BrandIconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" className={className} aria-label="Microsoft Outlook">
      {/* envelope */}
      <rect x="13" y="6" width="17" height="20" rx="1.5" fill="#1B9DE2" />
      <path d="M13 9.5 21.5 16 30 9.5V8a2 2 0 0 0-2-2H15a2 2 0 0 0-2 2z" fill="#28A8EA" />
      <path d="M13 24.5V11l8.5 6.2L30 11v13.5a1.5 1.5 0 0 1-1.5 1.5h-14a1.5 1.5 0 0 1-1.5-1.5z" fill="#0F78D4" opacity="0.55" />
      {/* blue tile with O */}
      <rect x="1" y="9" width="16" height="16" rx="2" fill="#0F6CBD" />
      <ellipse cx="9" cy="17" rx="4.6" ry="5.1" fill="none" stroke="#ffffff" strokeWidth="2.6" />
    </svg>
  )
}

export function GoogleGIcon({ size = 18, className }: BrandIconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 48 48" className={className} aria-label="Google">
      <path fill="#FFC107" d="M43.611 20.083H42V20H24v8h11.303c-1.649 4.657-6.08 8-11.303 8-6.627 0-12-5.373-12-12s5.373-12 12-12c3.059 0 5.842 1.154 7.961 3.039l5.657-5.657C34.046 6.053 29.268 4 24 4 12.955 4 4 12.955 4 24s8.955 20 20 20 20-8.955 20-20c0-1.341-.138-2.65-.389-3.917z" />
      <path fill="#FF3D00" d="m6.306 14.691 6.571 4.819C14.655 15.108 18.961 12 24 12c3.059 0 5.842 1.154 7.961 3.039l5.657-5.657C34.046 6.053 29.268 4 24 4 16.318 4 9.656 8.337 6.306 14.691z" />
      <path fill="#4CAF50" d="M24 44c5.166 0 9.86-1.977 13.409-5.192l-6.19-5.238A11.91 11.91 0 0 1 24 36c-5.202 0-9.619-3.317-11.283-7.946l-6.522 5.025C9.505 39.556 16.227 44 24 44z" />
      <path fill="#1976D2" d="M43.611 20.083H42V20H24v8h11.303a12.04 12.04 0 0 1-4.087 5.571l.003-.002 6.19 5.238C36.971 39.205 44 34 44 24c0-1.341-.138-2.65-.389-3.917z" />
    </svg>
  )
}

export function GmailIcon({ size = 18, className }: BrandIconProps) {
  // Official multicolor Gmail mark (2020 redesign)
  return (
    <svg width={size} height={size} viewBox="52 42 88 66" className={className} aria-label="Gmail">
      <path fill="#4285f4" d="M58 108h14V74L52 59v43c0 3.32 2.69 6 6 6" />
      <path fill="#34a853" d="M120 108h14c3.32 0 6-2.69 6-6V59l-20 15" />
      <path fill="#fbbc04" d="M120 48v26l20-15v-8c0-7.42-8.47-11.65-14.4-7.2" />
      <path fill="#ea4335" d="M72 74V48l24 18 24-18v26L96 92" />
      <path fill="#c5221f" d="M52 51v8l20 15V48l-5.6-4.2c-5.94-4.45-14.4-.22-14.4 7.2" />
    </svg>
  )
}

export function GoogleSheetsIcon({ size = 18, className }: BrandIconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" className={className} aria-label="Google Sheets">
      <path fill="#188038" d="M14 2H7a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V7l-5-5z" />
      <path fill="#34A853" d="M14 2v5h5l-5-5z" />
      <path
        fill="#fff"
        d="M8 11h8v7H8v-7zm1.3 1.3v1.2h2.2v-1.2H9.3zm3.2 0v1.2h2.2v-1.2h-2.2zm-3.2 2.4v1.2h2.2v-1.2H9.3zm3.2 0v1.2h2.2v-1.2h-2.2z"
      />
    </svg>
  )
}

export function GoogleDocsIcon({ size = 18, className }: BrandIconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" className={className} aria-label="Google Docs">
      <path fill="#4285F4" d="M14 2H7a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V7l-5-5z" />
      <path fill="#A1C2FA" d="M14 2v5h5l-5-5z" />
      <path fill="#fff" d="M8 11h8v1.4H8V11zm0 2.8h8v1.4H8v-1.4zm0 2.8h5.5V18H8v-1.4z" />
    </svg>
  )
}
