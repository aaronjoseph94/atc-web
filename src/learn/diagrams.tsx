/**
 * Tiny explanatory drawings for Learn mode, in the map's own colours: navy
 * pavement, white runway paint, yellow taxi markings, the white aircraft.
 * Each is a 240 × 120 SVG, drawn by hand to show one idea and nothing else.
 */
import type { ReactNode } from 'react'
import type { DiagramId } from './glossary'

const PAVE = '#2B3446'
const EDGE = 'rgba(255,255,255,0.55)'
const YELLOW = '#F5B93D'
const PURPLE = '#A78BFA'
const LABEL = 'rgba(255,255,255,0.72)'
const DIM = 'rgba(255,255,255,0.4)'
const GRASS = '#173226'
const SKY = '#101a2b'

/** Top-down airliner pointing up (north), about 22 units long at scale 1. */
const PLANE = 'M0,-11 C1.4,-11 1.7,-8.5 1.7,-6.5 L1.7,-2.2 L10.5,2.6 L10.5,4.6 L1.7,2.4 L1.3,7.2 L4.4,9.4 L4.4,10.9 L0,10 L-4.4,10.9 L-4.4,9.4 L-1.3,7.2 L-1.7,2.4 L-10.5,4.6 L-10.5,2.6 L-1.7,-2.2 L-1.7,-6.5 C-1.7,-8.5 -1.4,-11 0,-11 Z'

function Plane({ x, y, rot = 0, scale = 1, color = '#fff' }: { x: number; y: number; rot?: number; scale?: number; color?: string }) {
  return <path d={PLANE} transform={`translate(${x} ${y}) rotate(${rot}) scale(${scale})`} fill={color} stroke="rgba(0,0,0,0.35)" strokeWidth={0.6} />
}

function Text({ x, y, children, anchor = 'start', color = LABEL, size = 9, weight = 500 }: { x: number; y: number; children: ReactNode; anchor?: 'start' | 'middle' | 'end'; color?: string; size?: number; weight?: number }) {
  return (
    <text x={x} y={y} textAnchor={anchor} fill={color} fontSize={size} fontWeight={weight} style={{ fontFamily: 'inherit' }}>
      {children}
    </text>
  )
}

function Arrow({ d, color = PURPLE, dashed = false }: { d: string; color?: string; dashed?: boolean }) {
  return <path d={d} fill="none" stroke={color} strokeWidth={1.6} strokeDasharray={dashed ? '4 3' : undefined} markerEnd={`url(#learn-arrow-${color === PURPLE ? 'p' : color === YELLOW ? 'y' : 'w'})`} strokeLinecap="round" />
}

function Defs() {
  const head = (id: string, color: string) => (
    <marker id={id} viewBox="0 0 10 10" refX="7" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
      <path d="M0,0 L10,5 L0,10 z" fill={color} />
    </marker>
  )
  return (
    <defs>
      {head('learn-arrow-p', PURPLE)}
      {head('learn-arrow-y', YELLOW)}
      {head('learn-arrow-w', '#fff')}
    </defs>
  )
}

/** A horizontal runway band with edge lines and a dashed centreline. */
function RunwayH({ x, y, w, h = 24, numbers }: { x: number; y: number; w: number; h?: number; numbers?: [string, string] }) {
  return (
    <g>
      <rect x={x} y={y} width={w} height={h} fill={PAVE} rx={1.5} />
      <line x1={x + 3} x2={x + w - 3} y1={y + 2} y2={y + 2} stroke={EDGE} strokeWidth={0.8} />
      <line x1={x + 3} x2={x + w - 3} y1={y + h - 2} y2={y + h - 2} stroke={EDGE} strokeWidth={0.8} />
      <line x1={x + 22} x2={x + w - 22} y1={y + h / 2} y2={y + h / 2} stroke="#fff" strokeWidth={1.2} strokeDasharray="7 5" />
      {numbers && (
        <>
          <Text x={x + 10} y={y + h / 2 + 3.5} anchor="middle" color="#fff" size={9} weight={700}>
            {numbers[0]}
          </Text>
          <Text x={x + w - 10} y={y + h / 2 + 3.5} anchor="middle" color="#fff" size={9} weight={700}>
            {numbers[1]}
          </Text>
        </>
      )}
    </g>
  )
}

const DRAW: Record<DiagramId, () => ReactNode> = {
  holdShort: () => (
    <>
      <rect width="240" height="120" fill={GRASS} />
      <RunwayH x={0} y={14} w={240} h={30} />
      <Text x={8} y={11} color={DIM}>Runway</Text>
      {/* Taxiway up to the runway, with its yellow centreline. */}
      <rect x={108} y={44} width={30} height={76} fill={PAVE} />
      <line x1={123} x2={123} y1={44} y2={120} stroke={YELLOW} strokeWidth={1.2} />
      {/* Hold-short line: dashed pair toward the runway, solid pair toward the waiting aircraft. */}
      <line x1={108} x2={138} y1={52} y2={52} stroke={YELLOW} strokeWidth={1.6} strokeDasharray="3 2.5" />
      <line x1={108} x2={138} y1={56} y2={56} stroke={YELLOW} strokeWidth={1.6} strokeDasharray="3 2.5" />
      <line x1={108} x2={138} y1={60} y2={60} stroke={YELLOW} strokeWidth={1.6} />
      <line x1={108} x2={138} y1={64} y2={64} stroke={YELLOW} strokeWidth={1.6} />
      <Plane x={123} y={84} scale={1.05} />
      <Arrow d="M150,62 L141,62" color={YELLOW} />
      <Text x={153} y={60}>Hold-short line</Text>
      <Text x={153} y={71} color={DIM}>solid side faces you</Text>
      <Text x={153} y={92}>Stop here until</Text>
      <Text x={153} y={103}>told to cross</Text>
      <Text x={8} y={96} color={DIM}>Taxiway</Text>
    </>
  ),

  luaw: () => (
    <>
      <rect width="240" height="120" fill={GRASS} />
      <RunwayH x={6} y={46} w={228} h={30} numbers={['9', '27']} />
      <Plane x={40} y={61} rot={90} scale={1.05} />
      <Text x={14} y={24} color="#fff" weight={600}>Waiting on the runway,</Text>
      <Text x={14} y={36}>lined up on the centreline</Text>
      <Arrow d="M60,92 L204,92" color={PURPLE} dashed />
      <Text x={132} y={108} anchor="middle" color={DIM}>takeoff only after "cleared for takeoff"</Text>
    </>
  ),

  ils: () => (
    <>
      <rect width="240" height="120" fill={SKY} />
      {/* Top view: the localizer beam narrowing onto the runway. */}
      <Text x={6} y={11} color={DIM}>From above: localizer (left–right)</Text>
      <path d="M190,30 L20,16 L20,44 Z" fill="rgba(167,139,250,0.16)" />
      <line x1={20} x2={190} y1={30} y2={30} stroke={PURPLE} strokeWidth={1} strokeDasharray="4 3" />
      <rect x={188} y={26} width={48} height={8} fill={PAVE} />
      <Plane x={70} y={30} rot={90} scale={0.6} />
      {/* Side view: the glide slope down to the touchdown point. */}
      <Text x={6} y={62} color={DIM}>From the side: glide slope (up–down)</Text>
      <rect x={0} y={108} width={240} height={12} fill={GRASS} />
      <rect x={168} y={105} width={68} height={4} fill={PAVE} />
      <line x1={14} x2={182} y1={68} y2={106} stroke={PURPLE} strokeWidth={1.4} strokeDasharray="5 3" />
      <Plane x={84} y={84} rot={103} scale={0.7} />
      <path d="M150,106 A32,32 0 0 1 152,99" fill="none" stroke={LABEL} strokeWidth={0.8} />
      <Text x={128} y={103} anchor="end">≈3°</Text>
      <Text x={176} y={100} color={DIM}>touchdown</Text>
    </>
  ),

  goAround: () => (
    <>
      <rect width="240" height="120" fill={SKY} />
      <rect x={0} y={104} width={240} height={16} fill={GRASS} />
      <rect x={130} y={101} width={100} height={4} fill={PAVE} />
      <path d="M8,40 L120,94" fill="none" stroke={DIM} strokeWidth={1.4} strokeDasharray="5 3" />
      <Arrow d="M120,94 C150,108 170,70 226,22" color={PURPLE} />
      <Plane x={118} y={93} rot={110} scale={0.75} />
      <Text x={10} y={30}>Approach</Text>
      <Text x={160} y={20} anchor="end" color="#fff" weight={600}>Go around:</Text>
      <Text x={160} y={31} anchor="end">full power, climb away</Text>
      <Text x={180} y={116} anchor="middle" color={DIM}>runway not used</Text>
    </>
  ),

  runway: () => (
    <>
      <rect width="240" height="120" fill={GRASS} />
      <RunwayH x={18} y={28} w={204} h={22} numbers={['9L', '27R']} />
      <RunwayH x={18} y={72} w={204} h={22} numbers={['9R', '27L']} />
      <Arrow d="M232,18 L182,18" color={PURPLE} />
      <Text x={176} y={21} anchor="end">Heading west, 270°: runway 27</Text>
      <Arrow d="M8,106 L58,106" color={PURPLE} />
      <Text x={64} y={109}>Heading east, 090°: runway 9</Text>
      <g transform="translate(226 106)">
        <path d="M0,-9 L3,0 L0,-2 L-3,0 Z" fill="#fff" />
        <Text x={0} y={9} anchor="middle" size={7} color={DIM}>N</Text>
      </g>
      <Text x={232} y={65} anchor="end" color={DIM} size={8}>L / R as seen when lined up</Text>
    </>
  ),

  pattern: () => (
    <>
      <rect width="240" height="120" fill={GRASS} />
      <RunwayH x={70} y={88} w={100} h={14} />
      <path d="M40,95 L40,22 L200,22 L200,95" fill="none" stroke={PURPLE} strokeWidth={1.4} />
      <Arrow d="M170,95 L196,95" color={PURPLE} />
      <Arrow d="M200,80 L200,40" color={PURPLE} />
      <Arrow d="M170,22 L70,22" color={PURPLE} />
      <Arrow d="M40,36 L40,84" color={PURPLE} />
      <Arrow d="M44,95 L66,95" color={PURPLE} />
      <Text x={120} y={16} anchor="middle" color="#fff" weight={600}>Downwind</Text>
      <Text x={206} y={60}>Cross-</Text>
      <Text x={206} y={70}>wind</Text>
      <Text x={34} y={60} anchor="end">Base</Text>
      <Text x={54} y={112} anchor="middle" color="#fff" weight={600}>Final</Text>
      <Text x={196} y={112} anchor="middle">Upwind</Text>
      <Plane x={120} y={22} rot={-90} scale={0.6} />
    </>
  ),

  flightLevels: () => (
    <>
      <rect width="240" height="120" fill={SKY} />
      <rect x={0} y={110} width={240} height={10} fill={GRASS} />
      <rect x={0} y={4} width={240} height={52} fill="rgba(167,139,250,0.10)" />
      <line x1={0} x2={240} y1={56} y2={56} stroke={YELLOW} strokeWidth={1.2} strokeDasharray="6 4" />
      <Text x={6} y={52} color={YELLOW}>18,000 ft: transition altitude (US, Canada)</Text>
      <Text x={6} y={17} color="#fff" weight={600}>Flight levels</Text>
      <Text x={6} y={28}>altimeter on standard 29.92 / 1013</Text>
      <Plane x={190} y={22} rot={90} scale={0.7} />
      <Text x={176} y={40} anchor="middle">FL350 ≈ 35,000 ft</Text>
      <Text x={6} y={74} color="#fff" weight={600}>Altitudes in feet</Text>
      <Text x={6} y={85}>altimeter on the local setting (QNH)</Text>
      <Plane x={190} y={88} rot={90} scale={0.7} />
      <Text x={176} y={104} anchor="middle">"5,000"</Text>
    </>
  ),

  crosswind: () => (
    <>
      <rect width="240" height="120" fill={GRASS} />
      <RunwayH x={120} y={52} w={116} h={22} />
      <line x1={8} x2={120} y1={63} y2={63} stroke={DIM} strokeWidth={1} strokeDasharray="4 3" />
      <Plane x={66} y={63} rot={68} scale={1} />
      {[30, 80, 130, 180].map((x) => (
        <Arrow key={x} d={`M${x},8 L${x},30`} color="#fff" />
      ))}
      <Text x={196} y={22}>Wind</Text>
      <Text x={8} y={94} color="#fff" weight={600}>Nose turned into the wind,</Text>
      <Text x={8} y={105}>tracking straight down the centreline</Text>
    </>
  ),

  papi: () => {
    const row = (y: number, reds: number, label: string, on = false) => (
      <g key={label}>
        {[0, 1, 2, 3].map((i) => (
          <circle key={i} cx={30 + i * 20} cy={y} r={6.5} fill={i >= 4 - reds ? '#FF453A' : '#fff'} stroke="rgba(0,0,0,0.3)" />
        ))}
        <Text x={124} y={y + 3.5} color={on ? '#fff' : LABEL} weight={on ? 600 : 500}>
          {label}
        </Text>
      </g>
    )
    return (
      <>
        <rect width="240" height="120" fill={SKY} />
        {row(22, 1, 'Slightly high')}
        {row(60, 2, 'On the glide path', true)}
        {row(98, 3, 'Slightly low')}
      </>
    )
  },

  hold: () => (
    <>
      <rect width="240" height="120" fill={SKY} />
      <path d="M70,30 L170,30 A30,30 0 0 1 170,90 L70,90 A30,30 0 0 1 70,30 Z" fill="none" stroke={PURPLE} strokeWidth={1.4} />
      <Arrow d="M150,30 L110,30" color={PURPLE} />
      <Arrow d="M100,90 L140,90" color={PURPLE} />
      <path d="M170,84 L175,94 L165,94 Z" fill={YELLOW} />
      <Text x={182} y={104} color={YELLOW}>Fix</Text>
      <Plane x={120} y={90} rot={90} scale={0.6} />
      <Text x={120} y={64} anchor="middle" color="#fff" weight={600}>about 4 minutes a lap</Text>
      <Text x={120} y={20} anchor="middle" color={DIM}>1-minute straight legs</Text>
    </>
  ),

  clock: () => {
    const cx = 120
    const cy = 62
    const r = 44
    const at = (h: number, rr = r) => [cx + Math.sin((h / 12) * 2 * Math.PI) * rr, cy - Math.cos((h / 12) * 2 * Math.PI) * rr] as const
    const [tx, ty] = at(2)
    return (
      <>
        <rect width="240" height="120" fill={SKY} />
        <circle cx={cx} cy={cy} r={r} fill="none" stroke={DIM} strokeDasharray="2 4" />
        {[12, 3, 6, 9].map((h) => {
          const [x, y] = at(h, r + 9)
          return (
            <Text key={h} x={x} y={y + 3} anchor="middle" color="#fff" weight={600}>
              {h}
            </Text>
          )
        })}
        <Plane x={cx} y={cy} scale={1.05} />
        <Plane x={tx} y={ty} rot={250} scale={0.65} color={YELLOW} />
        <Text x={tx + 12} y={ty - 6} color={YELLOW}>Traffic,</Text>
        <Text x={tx + 12} y={ty + 5} color={YELLOW}>2 o’clock</Text>
      </>
    )
  },
}

export function Diagram({ id, label, className = '' }: { id: DiagramId; label: string; className?: string }) {
  return (
    <svg viewBox="0 0 240 120" role="img" aria-label={label} className={`block w-full overflow-hidden rounded-xl ${className}`}>
      <Defs />
      {DRAW[id]()}
    </svg>
  )
}
