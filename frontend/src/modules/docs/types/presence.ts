export interface DocViewer {
  userId: string
  name: string
  avatarUrl?: string | null
  avatarColor?: string | null
  /** Epoch ms — refreshed on heartbeat. */
  lastSeen: number
}
