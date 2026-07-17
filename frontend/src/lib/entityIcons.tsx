import {
  Box,
  Briefcase,
  Bug,
  Building2,
  Calendar,
  ClipboardList,
  Code,
  Compass,
  Cpu,
  Database,
  Flag,
  Folder,
  FolderKanban,
  Globe,
  Heart,
  Layers,
  Lightbulb,
  type LucideIcon,
  Megaphone,
  Package,
  Palette,
  PenTool,
  PieChart,
  Rocket,
  Server,
  Shield,
  ShoppingCart,
  Sparkles,
  Star,
  Target,
  Users,
  Wrench,
  Zap,
} from 'lucide-react'

/**
 * Curated lucide icons selectable for Spaces and Projects (the "Color & Icon"
 * menu). Stored on the entity as the string key; rendered with {@link EntityIcon}.
 */
export const ENTITY_ICONS: Record<string, LucideIcon> = {
  folder: Folder,
  'folder-kanban': FolderKanban,
  briefcase: Briefcase,
  rocket: Rocket,
  target: Target,
  flag: Flag,
  star: Star,
  heart: Heart,
  zap: Zap,
  bug: Bug,
  code: Code,
  palette: Palette,
  megaphone: Megaphone,
  users: Users,
  building: Building2,
  box: Box,
  layers: Layers,
  calendar: Calendar,
  clipboard: ClipboardList,
  compass: Compass,
  cpu: Cpu,
  database: Database,
  globe: Globe,
  lightbulb: Lightbulb,
  package: Package,
  'pen-tool': PenTool,
  'pie-chart': PieChart,
  server: Server,
  shield: Shield,
  cart: ShoppingCart,
  sparkles: Sparkles,
  wrench: Wrench,
}

export const ENTITY_ICON_KEYS = Object.keys(ENTITY_ICONS)

/** Renders a stored icon key, or `null` if the key is unset/unknown (caller shows a fallback). */
export function EntityIcon({
  icon,
  size = 14,
  className,
  style,
}: {
  icon: string | null | undefined
  size?: number
  className?: string
  style?: React.CSSProperties
}) {
  if (!icon) return null
  const Icon = ENTITY_ICONS[icon]
  if (!Icon) return null
  return <Icon size={size} className={className} style={style} />
}
