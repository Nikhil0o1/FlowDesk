export const COVER_PRESETS = [
  { id: 'preset:aurora', label: 'Aurora', className: 'bg-gradient-to-br from-violet-600 via-fuchsia-500 to-indigo-700' },
  { id: 'preset:night', label: 'Night sky', className: 'bg-gradient-to-br from-slate-900 via-indigo-950 to-purple-900' },
  { id: 'preset:sunset', label: 'Sunset', className: 'bg-gradient-to-br from-orange-400 via-rose-500 to-purple-600' },
  { id: 'preset:ocean', label: 'Ocean', className: 'bg-gradient-to-br from-cyan-500 via-blue-600 to-indigo-700' },
  { id: 'preset:forest', label: 'Forest', className: 'bg-gradient-to-br from-emerald-500 via-green-600 to-teal-800' },
  { id: 'preset:gold', label: 'Gold', className: 'bg-gradient-to-br from-amber-300 via-yellow-400 to-orange-400' },
  { id: 'preset:rose', label: 'Rose', className: 'bg-gradient-to-br from-pink-400 via-rose-400 to-red-500' },
  { id: 'preset:slate', label: 'Slate', className: 'bg-gradient-to-br from-slate-500 via-slate-600 to-slate-800' },
] as const

export function coverPresetClass(coverUrl: string | null | undefined): string | null {
  if (!coverUrl?.startsWith('preset:')) return null
  return COVER_PRESETS.find((p) => p.id === coverUrl)?.className ?? null
}

export function isCoverPreset(coverUrl: string | null | undefined): boolean {
  return !!coverUrl?.startsWith('preset:')
}
