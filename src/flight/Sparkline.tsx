/** Tiny filled trend line, as beside the speed and altitude on the flight card. */
export function Sparkline({ values, className = '' }: { values: (number | null)[]; className?: string }) {
  const pts = values.filter((v): v is number => v != null).slice(-40)
  const w = 44
  const h = 16
  if (pts.length < 3) return <svg viewBox={`0 0 ${w} ${h}`} className={className} aria-hidden />
  const min = Math.min(...pts)
  const max = Math.max(...pts)
  const span = max - min || 1
  const xy = pts.map((v, i) => [(i / (pts.length - 1)) * w, h - 2 - ((v - min) / span) * (h - 4)] as const)
  const line = xy.map(([x, y], i) => `${i ? 'L' : 'M'}${x.toFixed(1)} ${y.toFixed(1)}`).join(' ')
  return (
    <svg viewBox={`0 0 ${w} ${h}`} className={className} aria-hidden>
      <path d={`${line} L${w} ${h} L0 ${h} Z`} fill="currentColor" opacity={0.28} />
      <path d={line} fill="none" stroke="currentColor" strokeWidth={1.4} strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}
