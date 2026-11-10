import { useCallback, useEffect, useState, type PointerEvent as ReactPointerEvent } from 'react'
import { createVelocityTracker, DURATION, projectMomentum, releaseDuration, rubberband } from './motion'

type Options = {
  /** Dragged or flicked down far enough. */
  onDown?: () => void
  /** Dragged or flicked up far enough. */
  onUp?: () => void
  /** Distance in pixels that counts as a deliberate drag. */
  threshold?: number
  /** Checked when a drag starts; false leaves the pointer alone (e.g. a centred desktop modal). */
  enabled?: () => boolean
}

/** Movement before a press on the handle becomes a drag, so taps stay taps. */
const SLOP = 4

type Gesture = { y: number; lastY: number; id: number | 'touch'; moved: boolean; visual: number; height: number }

/**
 * Vertical drag for sheets, with the feel of a native sheet: it follows the
 * finger 1:1, resists in directions that do nothing, and on release either
 * commits (calls `onDown` / `onUp`) or settles back, carrying the finger's
 * speed into the motion that follows.
 *
 * Two ways to use it:
 *  - Pass `attach` as the ref of the moving element (and optionally
 *    `attachBackdrop` for its scrim, `attachScroll` for its scrolling body). The hook then moves the
 *    element directly, without re-rendering, and hands over to the element's
 *    `.motion-*` transition on release, so a dismiss continues from under the
 *    finger. `attachScroll` adds pull-to-dismiss from the top of the content.
 *  - Or spread `style` on the moving element (re-renders per move). On a
 *    commit the offset is held, so a keyframe exit that only names its end
 *    (`animate-sheet-out`) carries on from where the finger let go.
 *
 * Either way, spread `handlers` on the drag area (usually grabber and header).
 */
export function useSheetDrag({ onDown, onUp, threshold = 64, enabled }: Options) {
  const [dy, setDy] = useState(0)
  const [dragging, setDragging] = useState(false)
  const [settleMs, setSettleMs] = useState<number>(DURATION.sheet)
  // The gesture logic keeps its own mutable state, so one copy serves every render.
  const [engine] = useState(() => createEngine({ setDy, setDragging, setSettleMs }))
  useEffect(() => {
    engine.configure({ onDown, onUp, threshold, enabled })
  })

  const onPointerDown = (e: ReactPointerEvent) => {
    if (e.button !== 0) return
    // Let buttons and links inside the drag area work normally.
    if ((e.target as HTMLElement).closest('button, a, input, select, textarea, [data-no-drag]')) return
    if (enabled && !enabled()) return
    engine.begin(e.clientY, e.timeStamp, e.pointerId)
    e.currentTarget.setPointerCapture(e.pointerId)
  }
  const onPointerMove = (e: ReactPointerEvent) => {
    if (engine.gesture?.id === e.pointerId) engine.move(e.clientY, e.timeStamp)
  }
  const onPointerUp = (e: ReactPointerEvent) => {
    if (engine.gesture?.id === e.pointerId) engine.end(e.clientY, e.timeStamp)
  }
  // The browser took the pointer (a system gesture): settle back, never commit.
  const onPointerCancel = (e: ReactPointerEvent) => {
    if (engine.gesture?.id === e.pointerId) engine.end(engine.gesture.y, e.timeStamp, true)
  }

  // Pull-to-dismiss from the content: a downward drag that starts with the
  // list scrolled to the top moves the sheet instead of the list.
  const attachScroll = useCallback((node: HTMLElement | null) => engine.attachScroll(node), [engine])
  const attach = useCallback((node: HTMLElement | null) => engine.attach(node), [engine])
  const attachBackdrop = useCallback((node: HTMLElement | null) => engine.attachBackdrop(node), [engine])

  return {
    dragging,
    attach,
    attachBackdrop,
    attachScroll,
    handlers: { onPointerDown, onPointerMove, onPointerUp, onPointerCancel },
    style: {
      transform: dy ? `translateY(${dy}px)` : undefined,
      transition: dragging ? 'none' : `transform ${settleMs}ms var(--ease-sheet)`,
      touchAction: 'none' as const,
      // Read by the grabber inside (see `.sheet-grabber` in index.css).
      ['--sheet-stretch' as string]: dragging ? sheetStretch(dy, !!onDown, !!onUp) : 0,
    },
  }
}

/**
 * 0..1: how hard a sheet is being pulled in a direction that does nothing
 * (up on a sheet that can't grow, down on one that can't be dismissed). The
 * offset is already rubber-banded, so this saturates gently.
 */
export function sheetStretch(visual: number, canGoDown: boolean, canGoUp: boolean): number {
  const past = visual < 0 && !canGoUp ? -visual : visual > 0 && !canGoDown ? visual : 0
  return Math.min(1, past / 36)
}

type Latest = { onDown?: () => void; onUp?: () => void; threshold: number; enabled?: () => boolean }
type Setters = { setDy: (v: number) => void; setDragging: (v: boolean) => void; setSettleMs: (v: number) => void }
type Engine = ReturnType<typeof createEngine>

function createEngine({ setDy, setDragging, setSettleMs }: Setters) {
  const tracker = createVelocityTracker()
  const self = {
    /** The moving element, when the caller used `attach` (imperative mode). */
    el: null as HTMLElement | null,
    backdrop: null as HTMLElement | null,
    gesture: null as Gesture | null,
    latest: { threshold: 64 } as Latest,
    detach: null as (() => void) | null,
    begin,
    move,
    end,
    configure(latest: Latest) {
      self.latest = latest
    },
    attach(node: HTMLElement | null) {
      self.el = node
    },
    attachBackdrop(node: HTMLElement | null) {
      self.backdrop = node
    },
    attachScroll(node: HTMLElement | null) {
      self.detach?.()
      self.detach = node ? pullToDismiss(node, self) : null
    },
  }

  /** How far past its limit the sheet is being pulled, for the grabber's stretch. */
  function stretchOf(g: Gesture) {
    return sheetStretch(g.visual, !!self.latest.onDown, !!self.latest.onUp)
  }

  /** Where the sheet sits for a finger `d` pixels from where it started. */
  function visualOffset(d: number) {
    // Upward drags never lift a sheet off its resting edge; they only hint.
    if (d < 0) return rubberband(d, 90)
    return self.latest.onDown ? d : rubberband(d, 90)
  }

  function paint(g: Gesture) {
    const node = self.el
    if (!node) return
    node.style.transition = 'none'
    node.style.transform = g.visual ? `translateY(${g.visual}px)` : ''
    node.style.setProperty('--sheet-stretch', String(stretchOf(g)))
    const scrim = self.backdrop
    if (scrim) {
      scrim.style.transition = 'none'
      scrim.style.opacity = String(1 - Math.min(1, Math.max(0, g.visual / g.height)) * 0.85)
    }
  }

  /** Hand the element back to its CSS transition, at a pace that matches the release. */
  function release(ms: number) {
    for (const node of [self.el, self.backdrop]) {
      if (!node) continue
      node.style.setProperty('--motion-ms', `${ms}ms`)
      node.style.transition = ''
      node.style.transform = ''
      node.style.opacity = ''
      node.style.removeProperty('--sheet-stretch')
      // The custom pace is for this one motion; a later tap-to-close uses the default.
      const clear = () => node.style.removeProperty('--motion-ms')
      window.setTimeout(clear, ms + 60)
    }
  }

  function begin(y: number, t: number, id: number | 'touch') {
    self.gesture = { y, lastY: y, id, moved: false, visual: 0, height: self.el?.offsetHeight || 400 }
    tracker.reset()
    tracker.add(t, y)
  }

  function move(y: number, t: number) {
    const g = self.gesture
    if (!g) return
    const d = y - g.y
    g.lastY = y
    if (!g.moved) {
      if (Math.abs(d) < SLOP) return
      g.moved = true
      setDragging(true)
    }
    tracker.add(t, y)
    g.visual = visualOffset(d)
    if (self.el) paint(g)
    else setDy(g.visual)
  }

  function end(y: number, t: number, cancelled = false) {
    const g = self.gesture
    self.gesture = null
    if (!g?.moved) return
    setDragging(false)
    const { onDown: down, onUp: up, threshold: limit } = self.latest
    const d = y - g.y
    const v = cancelled ? 0 : tracker.velocity(t)

    const commitDown = !cancelled && !!down && d > SLOP && ((v > 0.45 && d > 12) || (d > limit && v > -0.2) || d + projectMomentum(v) > g.height * 0.5)
    const commitUp = !cancelled && !commitDown && !!up && d < -SLOP && ((v < -0.45 && d < -12) || (d < -limit && v < 0.2))

    if (self.el) {
      if (commitDown) {
        release(releaseDuration(g.height - g.visual, v, 160, DURATION.exit))
        down?.()
      } else {
        release(releaseDuration(g.visual, v, 220, 420))
        if (commitUp) up?.()
      }
      return
    }

    // Style mode: hold the offset on a commit so the exit animation starts from it.
    if (commitDown) {
      down?.()
      window.setTimeout(() => setDy(0), DURATION.sheet + 200)
    } else {
      setSettleMs(releaseDuration(g.visual, v, 220, 420))
      setDy(0)
      if (commitUp) up?.()
    }
  }

  return self
}

/** Touch listeners that let a pull from the top of a scrolled list drive the sheet. */
function pullToDismiss(node: HTMLElement, engine: Engine) {
  let startY = 0
  let startX = 0
  let armed = false
  const onStart = (e: TouchEvent) => {
    armed = false
    if (e.touches.length !== 1 || !engine.latest.onDown) return
    if (engine.latest.enabled && !engine.latest.enabled()) return
    startY = e.touches[0].clientY
    startX = e.touches[0].clientX
    armed = node.scrollTop <= 0
  }
  const onMove = (e: TouchEvent) => {
    const touch = e.touches[0]
    if (!touch) return
    if (engine.gesture?.id === 'touch') {
      e.preventDefault()
      engine.move(touch.clientY, e.timeStamp)
      return
    }
    if (!armed) return
    const dy = touch.clientY - startY
    const dx = touch.clientX - startX
    // Scrolling up, or sideways: this touch belongs to the list.
    if (dy < -2 || Math.abs(dx) > Math.abs(dy)) {
      armed = false
      return
    }
    if (dy > SLOP && node.scrollTop <= 0) {
      e.preventDefault()
      // Start one slop back, so the sheet moves with the finger from here without a leap.
      engine.begin(touch.clientY - SLOP, e.timeStamp - 16, 'touch')
      engine.move(touch.clientY, e.timeStamp)
    }
  }
  const onEnd = (e: TouchEvent) => {
    armed = false
    const g = engine.gesture
    if (g?.id === 'touch') engine.end(e.type === 'touchcancel' ? g.y : g.lastY, e.timeStamp, e.type === 'touchcancel')
  }
  node.addEventListener('touchstart', onStart, { passive: true })
  node.addEventListener('touchmove', onMove, { passive: false })
  node.addEventListener('touchend', onEnd)
  node.addEventListener('touchcancel', onEnd)
  return () => {
    node.removeEventListener('touchstart', onStart)
    node.removeEventListener('touchmove', onMove)
    node.removeEventListener('touchend', onEnd)
    node.removeEventListener('touchcancel', onEnd)
  }
}
