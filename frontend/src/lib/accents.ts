/** Selectable accent colors. Applied across the whole app chrome by setting
 * CSS variables on <html> (see App.tsx): the icon rail, primary buttons,
 * active/hover states, focus rings and highlights all derive from these.
 *
 * Buttons/highlights use the full `brand` in BOTH modes. The icon rail gets a
 * separate, theme-specific treatment so it looks intentional rather than a
 * jarring colored bar: a medium accent shade in light mode (`railLight`) and a
 * darker, muted, accent-tinted shade in dark mode (`railDark`) — mirroring
 * ClickUp. Every value keeps white text legible (verified ≥ 4.5:1).
 *
 *   brand     – the accent hue (buttons, highlights, borders, soft tints)
 *   rgb       – "r,g,b" of `brand`, so CSS can compose rgba() tints
 *   onBrand   – text/icon color placed ON a solid `brand` surface (button label)
 *   railLight – icon-rail background in light mode
 *   railDark  – icon-rail background in dark mode (muted, harmonizes with the dark surface)
 */
export type AccentKey =
  | 'blue'
  | 'purple'
  | 'pink'
  | 'violet'
  | 'indigo'
  | 'orange'
  | 'teal'
  | 'green'
  | 'red'
  | 'black'
  | 'bronze'
  | 'mint'

export interface Accent {
  key: AccentKey
  label: string
  brand: string
  rgb: string
  soft: string
  onBrand: string
  railLight: string
  railDark: string
}

const WHITE = '#FFFFFF'
const INK = '#0B172B'

export const ACCENTS: Accent[] = [
  { key: 'blue', label: 'Blue', brand: '#2B88EE', rgb: '43,136,238', soft: 'rgba(43,136,238,0.14)', onBrand: WHITE, railLight: '#1A5FB4', railDark: '#1C3A5B' },
  { key: 'purple', label: 'Purple', brand: '#7C5CFC', rgb: '124,92,252', soft: 'rgba(124,92,252,0.14)', onBrand: WHITE, railLight: '#5536C9', railDark: '#2C2553' },
  { key: 'pink', label: 'Pink', brand: '#EC4899', rgb: '236,72,153', soft: 'rgba(236,72,153,0.14)', onBrand: WHITE, railLight: '#B3215F', railDark: '#46213A' },
  { key: 'violet', label: 'Violet', brand: '#9B59B6', rgb: '155,89,182', soft: 'rgba(155,89,182,0.14)', onBrand: WHITE, railLight: '#6E3A86', railDark: '#352449' },
  { key: 'indigo', label: 'Indigo', brand: '#5B6BFF', rgb: '91,107,255', soft: 'rgba(91,107,255,0.14)', onBrand: WHITE, railLight: '#3340C4', railDark: '#232A55' },
  { key: 'orange', label: 'Orange', brand: '#F59E0B', rgb: '245,158,11', soft: 'rgba(245,158,11,0.14)', onBrand: INK, railLight: '#9A5B00', railDark: '#3C2C16' },
  { key: 'teal', label: 'Teal', brand: '#07BEA3', rgb: '7,190,163', soft: 'rgba(7,190,163,0.14)', onBrand: INK, railLight: '#066B5C', railDark: '#0E332D' },
  { key: 'green', label: 'Green', brand: '#4CB782', rgb: '76,183,130', soft: 'rgba(76,183,130,0.14)', onBrand: INK, railLight: '#2C6E4C', railDark: '#173527' },
  { key: 'red', label: 'Red', brand: '#F0506E', rgb: '240,80,110', soft: 'rgba(240,80,110,0.14)', onBrand: WHITE, railLight: '#B31F3C', railDark: '#43202A' },
  { key: 'black', label: 'Black', brand: '#434C5E', rgb: '67,76,94', soft: 'rgba(67,76,94,0.28)', onBrand: WHITE, railLight: '#2B3140', railDark: '#2E3440' },
  { key: 'bronze', label: 'Bronze', brand: '#A47551', rgb: '164,117,81', soft: 'rgba(164,117,81,0.18)', onBrand: WHITE, railLight: '#6E4C32', railDark: '#42331F' },
  { key: 'mint', label: 'Mint', brand: '#34D6A0', rgb: '52,214,160', soft: 'rgba(52,214,160,0.16)', onBrand: INK, railLight: '#0F6B4F', railDark: '#103A2C' },
]

export const DEFAULT_ACCENT: AccentKey = 'blue'

export function accentByKey(key: AccentKey): Accent {
  return ACCENTS.find((a) => a.key === key) ?? ACCENTS[0]
}
