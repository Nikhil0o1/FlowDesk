import { useEffect, useState } from 'react'

import { resolveMyTasksCardSize } from '../../lib/myTasksCardLayout'
import type { MyTasksCardId } from '../../lib/myTasksCards'
import { cn } from '../../lib/utils'
import { useUIStore } from '../../stores/ui'

function useLgUp() {
  const [lg, setLg] = useState(
    () => typeof window !== 'undefined' && window.matchMedia('(min-width: 1024px)').matches,
  )
  useEffect(() => {
    const mq = window.matchMedia('(min-width: 1024px)')
    const onChange = () => setLg(mq.matches)
    mq.addEventListener('change', onChange)
    return () => mq.removeEventListener('change', onChange)
  }, [])
  return lg
}

export function MyTasksCardGrid({
  cardIds,
  onReorder,
  renderCard,
}: {
  cardIds: MyTasksCardId[]
  onReorder: (next: MyTasksCardId[]) => void
  renderCard: (
    id: MyTasksCardId,
    drag: {
      onDragStart: () => void
      onDragOver: (e: React.DragEvent) => void
      onDrop: () => void
      isDragTarget: boolean
      isDragging: boolean
    },
  ) => React.ReactNode
}) {
  const [dragId, setDragId] = useState<MyTasksCardId | null>(null)
  const [dropTargetId, setDropTargetId] = useState<MyTasksCardId | null>(null)
  const sizeOverrides = useUIStore((s) => s.myTasksCardSizes)
  const lgUp = useLgUp()

  const handleDrop = (targetId: MyTasksCardId) => {
    if (!dragId || dragId === targetId) {
      setDragId(null)
      setDropTargetId(null)
      return
    }
    const next = [...cardIds]
    const from = next.indexOf(dragId)
    const to = next.indexOf(targetId)
    if (from < 0 || to < 0) return
    next.splice(from, 1)
    next.splice(to, 0, dragId)
    onReorder(next)
    setDragId(null)
    setDropTargetId(null)
  }

  return (
    <div className="grid grid-cols-1 gap-5 lg:grid-cols-12">
      {cardIds.map((id) => {
        const { colSpan } = resolveMyTasksCardSize(id, sizeOverrides[id])
        return (
          <div
            key={id}
            className={cn('min-w-0', dragId === id && 'opacity-60')}
            style={{ gridColumn: lgUp ? `span ${colSpan}` : undefined }}
          >
            {renderCard(id, {
              onDragStart: () => setDragId(id),
              onDragOver: (e) => {
                e.preventDefault()
                setDropTargetId(id)
              },
              onDrop: () => handleDrop(id),
              isDragTarget: dropTargetId === id && dragId !== null && dragId !== id,
              isDragging: dragId === id,
            })}
          </div>
        )
      })}
    </div>
  )
}
