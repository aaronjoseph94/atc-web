import { useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'

type Options = {
  /** Dragged or flicked down far enough. */
  onDown?: () => void
  /** Dragged or flicked up far enough. */
  onUp?: () => void
  /** Distance in pixels that counts as a deliberate drag. */
  threshold?: number
}

/**
 * Vertical drag for sheets: the element follows the finger, and on release it
 * either commits (calls `onDown` / `onUp`) or springs back. Spread `handlers`
 * on the drag area and apply `style` to the element that should move.
 */
export function useSheetDrag({ onDown, onUp, threshold = 64 }: Options) {
  const [dy, setDy] = useState(0)
  const [dragging, setDragging] = useState(false)
  const start = useRef<{ y: number; t: number; id: number } | null>(null)

  const onPointerDown = (e: ReactPointerEvent) => {
    // Let buttons and links inside the drag area work normally.
    if ((e.target as HTMLElement).closest('button, a, input, select, [data-no-drag]')) return
    start.current = { y: e.clientY, t: e.timeStamp, id: e.pointerId }
    e.currentTarget.setPointerCapture(e.pointerId)
    setDragging(true)
  }
  const onPointerMove = (e: ReactPointerEvent) => {
    const s = start.current
    if (!s || e.pointerId !== s.id) return
    let d = e.clientY - s.y
    // Resist drags in a direction that does nothing.
    if (d < 0 && !onUp) d *= 0.2
    if (d > 0 && !onDown) d *= 0.2
    setDy(d)
  }
  const finish = (e: ReactPointerEvent) => {
    const s = start.current
    if (!s || e.pointerId !== s.id) return
    start.current = null
    const d = e.clientY - s.y
    const velocity = d / Math.max(1, e.timeStamp - s.t) // px per ms
    setDragging(false)
    setDy(0)
    if ((d > threshold || velocity > 0.6) && d > 8) onDown?.()
    else if ((d < -threshold || velocity < -0.6) && d < -8) onUp?.()
  }

  return {
    dragging,
    handlers: { onPointerDown, onPointerMove, onPointerUp: finish, onPointerCancel: finish },
    style: {
      transform: dy ? `translateY(${dy}px)` : undefined,
      transition: dragging ? 'none' : 'transform 0.32s cubic-bezier(0.22, 1, 0.36, 1)',
      touchAction: 'none' as const,
    },
  }
}
